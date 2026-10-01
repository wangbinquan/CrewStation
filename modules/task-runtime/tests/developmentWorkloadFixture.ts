import type { TaskId, TaskProfileDto } from '@crewstation/contracts';
import { DEVELOPMENT_REMOVAL_ANNOTATION, ProjectIdSchema, ServiceIdSchema, TaskIdSchema } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { newId, noopLogger } from '@crewstation/kernel';
import { createFakeK8sClient, Resources } from '@crewstation/k8s';
import type { K8sObject } from '@crewstation/k8s';
import { createResourcesModule, resourcesMigrations } from '@crewstation/module-resources';
import { createClusterControlModule } from '@crewstation/module-cluster-control';
import type { Worker } from '@crewstation/queue';
import { queueMigrations } from '@crewstation/queue';
import { createTestDatabase } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import type { CreateNativeExecutionInput } from '../api/moduleApi';
import { createTaskRuntimeModule, taskRuntimeMigrations } from '../wiring';
import { drizzleUnitOfWork } from '../adapters/persistence/drizzleUnitOfWork';

async function developmentDatabase() {
  const tdb = await createTestDatabase([eventbusMigrations, queueMigrations, resourcesMigrations, taskRuntimeMigrations]), k8s = createFakeK8sClient();
  const create = k8s.create.bind(k8s);
  k8s.create = (object) => create({ ...object, metadata: { ...object.metadata, uid: object.metadata.uid ?? crypto.randomUUID() } });
  const state = { quota: 8, profiles: [
    { id: '01a0bf5d-8f4b-7001-8458-107366e7de39', name: 'coding-medium', cpu: '1', memory: '2Gi', storage: '10Gi', description: '' },
    { id: '01a0bf5d-8f4b-7f2b-8caf-3349046050a1', name: 'coding-large', cpu: '2', memory: '4Gi', storage: '20Gi', description: '' },
  ] as TaskProfileDto[] };
  const resources = createResourcesModule({ db: tdb.db, quotas: { limitFor: async () => state.quota }, authorizer: { projectAccess: async () => ({ operate: true }) }, isAdmin: async () => true });
  const owner = resources.api.owner('task-runtime'), uow = drizzleUnitOfWork(tdb.db);
  const ledger = { within: (tx: object) => owner.within(tx), live: async () => (await resources.api.list({})).filter((r) => r.owner.module === 'task-runtime'), occupancy: resources.api.occupancy };
  return { tdb, k8s, state, resources, owner, uow, ledger, projectId: ProjectIdSchema.parse('01a0bf5d-8f4b-7fc7-8b88-18362617594b'), serviceId: ServiceIdSchema.parse('01a0bf5d-8f4b-77df-8856-e078a980dc2f') };
}
type Base = Awaited<ReturnType<typeof developmentDatabase>>;
function runtimeDeps(base: Base, calls: string[]): Parameters<typeof createTaskRuntimeModule>[0] {
  return { db: base.tdb.db, k8s: base.k8s, authorizer: { authorize: async () => {} }, isAdmin: async () => true, ledger: base.ledger, workloadSafety: base.resources.api.workloadSafety,
    quotas: { quotaLimit: async () => base.state.quota },
    profiles: { devSessionProfile: async () => undefined, listTaskProfiles: async () => base.state.profiles, getTaskProfile: async (id) => base.state.profiles.find((p) => p.id === id) },
    clock: { now: () => new Date() }, services: { resolveServiceById: async () => ({ projectId: base.projectId, namespace: 'cs-qa', slug: 'qa', name: 'qa' }) },
    sources: { configEnv: async () => { calls.push('materials'); return { GREETING: 'original' }; }, dataEnv: async () => ({}), taskDataEnv: async () => ({}) },
    settings: { taskImage: 'task:current', sessionUrl: 'ws://offline', systemNamespace: 'cs-system', userDomain: 'localhost', serviceDomain: 'svc.localhost', workerUid: 10001, defaultProfile: base.state.profiles[0]!.id, userAuthMiddleware: 'auth', dropIdentityHeadersMiddleware: 'drop' } };
}
async function originalWorkspace(base: Base, deps: Parameters<typeof createTaskRuntimeModule>[0]) {
  const runtime = createTaskRuntimeModule(deps);
  const created = await runtime.api.createEnvironment({ serviceId: base.serviceId, kind: 'dev-session', labels: { 'crewstation.io/project': 'qa', 'crewstation.io/service': 'qa' } });
  const env = (await base.uow.read.environments.getById(created.id))!;
  const parentPod = (await base.k8s.get(Resources.Pod!, env.podName, env.namespace))!, pvc = (await base.k8s.get(Resources.PersistentVolumeClaim!, env.pvcName, env.namespace))!;
  const token = (parentPod.spec as { containers: Array<{ env: Array<{ name: string; value: string }> }> }).containers[0]!.env.find((v) => v.name === 'CS_RUNNER_TOKEN')!.value;
  await base.k8s.mergePatch(Resources.Pod!, env.podName, env.namespace, { spec: { nodeName: 'worker-one' }, status: { phase: 'Running' } });
  await base.k8s.mergePatch(Resources.PersistentVolumeClaim!, env.pvcName, env.namespace, { status: { phase: 'Bound' } });
  await runtime.api.onRunnerConnected(env.id, token);
  const parent = (await base.uow.read.environments.getById(env.id))!;
  const prime = async () => {
    const volume = (await base.owner.find(parent.id + '/work', 'volume'))!;
    await base.resources.api.observe({ resourceId: parent.id, child: { kind: 'Pod', namespace: parent.namespace, name: parent.podName, uid: parentPod.metadata.uid!, phase: 'Running', ready: true, node: 'worker-one' } });
    await base.resources.api.observe({ resourceId: volume.id, child: { kind: 'PersistentVolumeClaim', namespace: parent.namespace, name: parent.pvcName, uid: pvc.metadata.uid!, phase: 'Bound', ready: true } });
  };
  return { parent, parentPod, parentToken: token, pvc, prime };
}
type Faults = { bind: boolean; grant: boolean; activation: boolean };
function controlledCluster(base: Base, calls: string[], faults: Faults, emit: (event: string) => void, historicalUnmarked: boolean) {
  const rawCreate = base.k8s.create.bind(base.k8s), rawGet = base.k8s.get.bind(base.k8s);
  base.k8s.get = async <T extends K8sObject>(...args: Parameters<typeof rawGet>) => { calls.push('get:' + args[1]); const object = await rawGet<T>(...args); emit('read:' + args[1]); return object; };
  base.k8s.create = async (input) => {
    const object = structuredClone(input);
    if (historicalUnmarked && object.metadata.annotations) delete object.metadata.annotations[DEVELOPMENT_REMOVAL_ANNOTATION];
    if (object.kind === 'Pod' && object.metadata.labels?.['crewstation.io/workspace-task']) {
      const spec = object.spec as { nodeName?: string; containers: Array<{ env?: Array<{ valueFrom?: { fieldRef?: { apiVersion?: string } } }> }>; initContainers?: Array<{ env?: Array<{ valueFrom?: { fieldRef?: { apiVersion?: string } } }> }> };
      spec.nodeName = 'worker-one'; Object.assign(object, { status: { phase: 'Pending' } });
      for (const container of [...spec.containers, ...spec.initContainers ?? []]) for (const variable of container.env ?? []) if (variable.valueFrom?.fieldRef) variable.valueFrom.fieldRef.apiVersion = 'v1';
    }
    calls.push('create:' + object.metadata.name);
    const created = await rawCreate(object);
    if (object.kind === 'Secret' && object.metadata.name.endsWith('-admission')) { emit('activation'); if (faults.activation) throw new Error('activation response lost'); }
    return created;
  };
}
function workloadController(base: Base, runtime: () => ReturnType<typeof createTaskRuntimeModule>, safety: typeof base.resources.api.workloadSafety, faults: Faults, emit: (event: string) => void, calls: string[]) {
  const objects = () => [...base.k8s.objects.values()];
  return createClusterControlModule({ logger: { ...noopLogger, warn: (m, data) => calls.push('warn:' + m + ' ' + JSON.stringify(data)), error: (m, data) => calls.push('error:' + m + ' ' + JSON.stringify(data)) }, k8s: base.k8s, systemNamespace: 'cs-system', isAdmin: async () => true, orphanSweep: false, reconciler: { pollMs: 10, retryMs: 10, concurrency: 1 },
    ledger: { ...base.resources.api, workloadSafety: safety, listLive: () => base.resources.api.list({}), children: (parentId) => base.resources.api.list({ parentId, includeStopped: true }), adoptOrphanVolume: async () => {} },
    legacy: { resolveTaskId: async () => undefined, task: async () => undefined },
    feed: { start: () => {}, stop: async () => {}, synced: async () => {}, cached: (kind, ns, name) => objects().find((o) => o.kind === kind && o.metadata.namespace === ns && o.metadata.name === name), list: (kind) => objects().filter((o) => o.kind === kind) },
    workloads: { inspectDevelopmentRemoval: (target) => runtime().api.inspectDevelopmentRemoval(target), runnerValues: (id) => runtime().api.runnerValues(TaskIdSchema.parse(id)), checkoutValues: (id) => runtime().api.checkoutValues(TaskIdSchema.parse(id)),
      bindWorkload: async (id, podUid, secretUid) => { if (faults.bind) { emit('binding-failed'); throw new Error('bind commit lost'); } await runtime().api.bindWorkload(TaskIdSchema.parse(id), podUid, secretUid); emit('bound'); },
      workloadUnavailable: (id, code) => runtime().api.workloadUnavailable(TaskIdSchema.parse(id), code) } });
}
export async function developmentWorkloadFixture(creation: 'ledger' | 'native' = 'ledger', observed = true, historicalUnmarked = false) {
  const base = await developmentDatabase(), calls: string[] = [], faults: Faults = { bind: false, grant: false, activation: false }, deps = runtimeDeps(base, calls);
  const workspace = await originalWorkspace(base, deps), { parent, prime } = workspace;
  if (observed) await prime();
  const nodeUid = crypto.randomUUID();
  await base.k8s.create({ apiVersion: 'v1', kind: 'Node', metadata: { name: 'worker-one', uid: nodeUid }, status: { conditions: [{ type: 'Ready', status: 'True' }], nodeInfo: { kubeletVersion: 'v1.35.0' } } });
  await base.k8s.create({ apiVersion: 'coordination.k8s.io/v1', kind: 'Lease', metadata: { name: 'worker-one', namespace: 'kube-node-lease', ownerReferences: [{ apiVersion: 'v1', kind: 'Node', name: 'worker-one', uid: nodeUid }] }, spec: { holderIdentity: 'worker-one', renewTime: new Date().toISOString() } });
  const listeners = new Map<string, Array<() => void>>(), timers = new Set<ReturnType<typeof setTimeout>>();
  const emit = (event: string) => { for (const done of listeners.get(event) ?? []) done(); listeners.delete(event); };
  const receipt = (event: string) => new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('missing actual receipt: ' + event)), 8_000); timers.add(timer);
    const done = () => { clearTimeout(timer); timers.delete(timer); resolve(); };
    listeners.set(event, [...listeners.get(event) ?? [], done]);
  });
  controlledCluster(base, calls, faults, emit, historicalUnmarked);
  const safety = { ...base.resources.api.workloadSafety, register: async (consumer: Parameters<typeof base.resources.api.workloadSafety.register>[0]) => {
    calls.push('register'); const value = await base.resources.api.workloadSafety.register(consumer); emit('registered'); return value;
  }, grantStart: async (id: string, permit: Parameters<typeof base.resources.api.workloadSafety.grantStart>[1]) => {
    const value = await base.resources.api.workloadSafety.grantStart(id, permit); emit('grant');
    if (faults.grant) { emit('grant-lost'); throw new Error('grant response lost'); } return value;
  } };
  Object.assign(deps, { workloadSafety: safety, ...(creation === 'ledger' ? { creation: 'ledger' as const } : {}) });
  let runtime = createTaskRuntimeModule(deps);
  let closed = false;
  const controllers: ReturnType<typeof createClusterControlModule>[] = [];
  const controller = () => { const control = workloadController(base, () => runtime, safety, faults, emit, calls); controllers.push(control); return control; };
  const request = (): CreateNativeExecutionInput & { developmentUsageProtection: { version: 1 } } => ({ id: newId('tsk') as TaskId, parentTaskId: parent.id, purpose: 'agent',
    agentId: newId('agt'), runnerId: crypto.randomUUID(), fingerprint: 'a'.repeat(64), image: 'task@sha256:' + 'a'.repeat(64),
    computeProfile: { profileId: base.state.profiles[0]!.id, revision: 3 }, developmentUsageStorage: { version: 1 }, developmentUsageProtection: { version: 1 } });
  calls.length = 0;
  return { ...base, ...workspace, get runtime() { return runtime; }, deps, safety, calls, faults, receipt, controller, request, profiles: base.state.profiles,
    load: async (id: TaskId) => (await base.uow.read.environments.getById(id))!,
    replace: (patch: Partial<typeof deps> = {}) => { runtime = createTaskRuntimeModule({ ...deps, ...patch }); return runtime; },
    runNative: async () => { await base.tdb.db.execute(sql`UPDATE platform_infra.jobs SET run_at = clock_timestamp() - interval '1 second'`); return (runtime.workers[1] as Worker).runOnce(); },
    close: async () => { if (closed) return; closed = true; for (const control of controllers) await control.observer.stop(); for (const timer of timers) clearTimeout(timer); await base.tdb.drop(); } };
}
export type DevelopmentWorkloadFixture = Awaited<ReturnType<typeof developmentWorkloadFixture>>;
