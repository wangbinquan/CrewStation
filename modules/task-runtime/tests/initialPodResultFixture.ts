// Real PostgreSQL and original Task/Resources entry points; only Kubernetes ACK timing is controlled.
import type { TaskId, TaskKind, TaskProfileDto } from '@crewstation/contracts';
import { ProjectIdSchema, ServiceIdSchema } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { newId, noopLogger } from '@crewstation/kernel';
import { createFakeK8sClient, Resources } from '@crewstation/k8s';
import { createResourcesModule, resourcesMigrations } from '@crewstation/module-resources';
import { queueMigrations } from '@crewstation/queue';
import { createTestDatabase } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { kubernetesTaskCluster } from '../adapters/k8s/taskCluster';
import { drizzleUnitOfWork } from '../adapters/persistence/drizzleUnitOfWork';
import type { TaskRuntimeUseCaseDeps } from '../application/dependencies';
import { createTestEnvironmentUseCase } from '../application/testEnvironment';
import type { TaskEnvironment } from '../domain/taskEnvironment';
import { createTaskRuntimeModule, taskRuntimeMigrations } from '../wiring';

function checkpoint<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
export async function initialPodResultFixture() {
  const tdb = await createTestDatabase([eventbusMigrations, queueMigrations, resourcesMigrations, taskRuntimeMigrations]);
  const k8s = createFakeK8sClient(), create = k8s.create.bind(k8s);
  k8s.create = (object) => create({ ...object, metadata: { ...object.metadata, uid: object.metadata.uid ?? crypto.randomUUID() } });
  const projectId = ProjectIdSchema.parse('01a0bf5d-8f4b-7fc7-8b88-18362617594b');
  const serviceId = ServiceIdSchema.parse('01a0bf5d-8f4b-77df-8856-e078a980dc2f');
  const profile: TaskProfileDto = { id: '01a0bf5d-8f4b-7001-8458-107366e7de39', name: 'coding-medium', cpu: '1', memory: '2Gi', storage: '10Gi', description: '' };
  const resources = createResourcesModule({ db: tdb.db, quotas: { limitFor: async () => 8 }, authorizer: { projectAccess: async () => ({ operate: true }) }, isAdmin: async () => true });
  const owner = resources.api.owner('task-runtime');
  const ledger = { within: (tx: object) => owner.within(tx), live: async () => (await resources.api.list({})).filter((r) => r.owner.module === 'task-runtime'), occupancy: resources.api.occupancy };
  const uow = drizzleUnitOfWork(tdb.db, { ledger }), cluster = kubernetesTaskCluster(k8s, 10001), rawPod = cluster.createPod.bind(cluster);
  type Barrier = { created: ReturnType<typeof checkpoint<TaskEnvironment>>; release: ReturnType<typeof checkpoint<void>>; error?: Error };
  let armed: Barrier | undefined;
  const barriers: Barrier[] = [], pending: Array<Promise<unknown>> = [], warnings: string[] = [];
  cluster.createPod = async (spec) => {
    const barrier = armed; armed = undefined;
    const uid = await rawPod(spec);
    if (barrier) { barrier.created.resolve(spec.env); await barrier.release.promise; if (barrier.error) throw barrier.error; }
    return uid;
  };
  const deps: TaskRuntimeUseCaseDeps = { uow, cluster, workloadSafety: resources.api.workloadSafety,
    authorizer: { authorize: async () => {} }, quotas: { quotaLimit: async () => 8 },
    profiles: { devSessionProfile: async () => undefined, listTaskProfiles: async () => [profile], getTaskProfile: async (id) => id === profile.id ? profile : undefined },
    services: { resolveServiceById: async () => ({ projectId, namespace: 'cs-qa', slug: 'qa', name: 'qa' }) },
    sources: { configEnv: async () => ({ GREETING: 'original' }), dataEnv: async () => ({}), taskDataEnv: async () => ({}) },
    settings: { taskImage: 'task:current', sessionUrl: 'ws://offline', systemNamespace: 'cs-system', userDomain: 'localhost', serviceDomain: 'svc.localhost', workerUid: 10001, defaultProfile: profile.id, userAuthMiddleware: 'auth', dropIdentityHeadersMiddleware: 'drop' },
    clock: { now: () => new Date() }, logger: { ...noopLogger, warn: (message) => { warnings.push(message); } } };
  const runtime = createTaskRuntimeModule({ ...deps, db: tdb.db, k8s, ledger, isAdmin: async () => true });
  const load = async (id: TaskId) => (await uow.read.environments.getById(id))!;
  const start = async (kind: TaskKind = 'dev-session', volumeMode: 'persistent' | 'follow-container' = 'follow-container', resumeId?: TaskId) => {
    const barrier: Barrier = { created: checkpoint<TaskEnvironment>(), release: checkpoint<void>() };
    barriers.push(barrier); armed = barrier;
    const work = resumeId ? runtime.api.resumeEnvironment(resumeId)
      : kind === 'profile-test' ? createTestEnvironmentUseCase(deps)({ image: 'profile:test', taskProfile: profile.id })
      : runtime.api.createEnvironment({ serviceId, kind, volumeMode, labels: { 'crewstation.io/project': 'qa', 'crewstation.io/service': 'qa' } });
    const settled = work.then(value => ({ value, error: undefined }), error => ({ value: undefined, error: error as unknown }));
    pending.push(settled);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const original = await Promise.race([barrier.created.promise, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('original Pod create checkpoint missing')), 8000); })]);
      return { original, settled, finish: (error?: Error) => { barrier.error = error; barrier.release.resolve(); } };
    } finally { if (timer) clearTimeout(timer); }
  };
  const connect = async (env: TaskEnvironment) => {
    const pod = (await k8s.get(Resources.Pod!, env.podName, env.namespace))!;
    const token = (pod.spec as { containers: Array<{ env: Array<{ name: string; value: string }> }> }).containers[0]!.env.find((v) => v.name === 'CS_RUNNER_TOKEN')!.value;
    await k8s.mergePatch(Resources.Pod!, env.podName, env.namespace, { spec: { nodeName: 'worker-one' }, status: { phase: 'Running' } });
    await k8s.mergePatch(Resources.PersistentVolumeClaim!, env.pvcName, env.namespace, { status: { phase: 'Bound', capacity: { storage: profile.storage } } });
    await runtime.api.onRunnerConnected(env.id, token);
    const volume = await owner.find(env.id + '/work', 'volume');
    await resources.api.observe({ resourceId: env.id, child: { kind: 'Pod', namespace: env.namespace, name: env.podName, uid: pod.metadata.uid!, phase: 'Running', ready: true, node: 'worker-one' } });
    if (volume) {
      const pvc = (await k8s.get(Resources.PersistentVolumeClaim!, env.pvcName, env.namespace))!;
      await resources.api.observe({ resourceId: volume.id, child: { kind: 'PersistentVolumeClaim', namespace: env.namespace, name: env.pvcName, uid: pvc.metadata.uid!, phase: 'Bound', ready: true } });
    }
    return load(env.id);
  };
  const seal = async (env: TaskEnvironment) => {
    const child = await runtime.api.createNativeExecution({ id: newId('tsk') as TaskId, parentTaskId: env.id, purpose: 'agent',
      agentId: newId('agt'), runnerId: crypto.randomUUID(), fingerprint: 'a'.repeat(64), image: 'task@sha256:' + 'a'.repeat(64),
      computeProfile: { profileId: profile.id, revision: 3 }, developmentUsageStorage: { version: 1 }, developmentUsageProtection: { version: 1 } });
    await runtime.api.releaseEnvironment(env.id, 'user');
    return child;
  };
  const snapshot = async () => ({
    tasks: Array.from(await tdb.db.execute(sql`SELECT row_to_json(e)::text AS value, e.render IS NOT NULL AS render_present, jsonb_typeof(e.render) AS render_kind, e.render::text AS render_raw, e.native IS NOT NULL AS native_present, jsonb_typeof(e.native) AS native_kind, e.native::text AS native_raw FROM task_runtime.environments e ORDER BY id`)),
    jobs: Array.from(await tdb.db.execute(sql`SELECT row_to_json(j)::text AS value FROM platform_infra.jobs j ORDER BY id`)),
    resources: await resources.api.list({ projectId, includeStopped: true }),
    used: await resources.api.occupancy(projectId), admissions: await uow.read.admissions.running(projectId),
  });
  let closed = false;
  return { tdb, k8s, projectId, serviceId, profile, resources, uow, deps, runtime, warnings, start, load, connect, seal, snapshot,
    close: async () => { if (closed) return; closed = true; for (const b of barriers) b.release.resolve(); await Promise.all(pending); await tdb.drop(); } };
}
export type InitialPodResultFixture = Awaited<ReturnType<typeof initialPodResultFixture>>;
