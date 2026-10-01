// RFC-034: preserve the original numeric stores and admission Secret; never degrade a new protection choice to the old writer.
import { expect, test } from 'bun:test';
import { ProjectIdSchema, ServiceIdSchema, TaskIdSchema, TraceIdSchema, WORKLOAD_STOP_FINALIZER } from '@crewstation/contracts';
import { createFakeK8sClient, Resources, secretObject } from '@crewstation/k8s';
import type { K8sObject } from '@crewstation/k8s';
import { createResourcesModule, resourcesMigrations } from '@crewstation/module-resources';
import { createClusterControlModule } from '@crewstation/module-cluster-control';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TaskEnvironment } from '../domain/taskEnvironment';
import { projectEnvironment } from '../domain/ledgerProjection';
import { runnerSecretOf } from '../domain/taskEnvironment';
import { taskPodObject } from '../adapters/k8s/taskObjects';
import { kubernetesNativeExecutions } from '../adapters/k8s/nativeExecutions';

const id = (n: number) => '019f0000-0000-7000-8000-' + String(n).padStart(12, '0');
const available = await testDatabaseAvailable();
function environment(protectedSelection = true, ledger = true): TaskEnvironment & { readonly render: NonNullable<TaskEnvironment['render']> } {
  const at = new Date('2026-09-30T18:00:00Z'), resources = { cpu: '1', memory: '2Gi', storage: '10Gi' };
  return { id: TaskIdSchema.parse(id(3)), projectId: ProjectIdSchema.parse(id(1)), serviceId: ServiceIdSchema.parse(id(6)), kind: 'dev-session', state: 'creating', volumeMode: 'persistent', profile: id(5),
    namespace: 'cs-protection', podName: 'agent-protection', pvcName: 'original-work', traceId: TraceIdSchema.parse('a'.repeat(32)), labels: { 'crewstation.io/project': 'project-name', 'crewstation.io/service': 'service-name' }, runnerTokenHash: 'hash', connected: false, createdAt: at, updatedAt: at, lastActivityAt: at,
    render: { image: 'task@sha256:fixture', workerUid: 10001, resources, start: 1, developmentUsageStorage: { version: 1 },
      ...(protectedSelection ? { developmentUsageProtection: { version: 1 }, workloadConsumerId: id(7) } : {}), ...(ledger ? { execution: { workspacePod: 'original-parent' } } : {}) },
    native: { purpose: 'agent', parentTaskId: TaskIdSchema.parse(id(2)), parentPodUid: 'd624eb08-2bfa-46f6-812f-29bdecc0d961', pvcUid: 'd7aa3cff-94e3-453a-9c04-c6f7a8678438', nodeName: 'original-node', agentId: id(4), runnerId: '8dc512c9-cc5d-4c20-8591-3e2546456d67', fingerprint: 'a'.repeat(64), requestedProfile: null,
      profile: { id: id(5), name: 'Named compute', ...resources }, computeProfile: { profileId: id(8), revision: 3 }, image: 'task@sha256:fixture', state: 'queued' } };
}

test('both projection branches claim the protected admission Secret; old selections keep their exact child sets', () => {
  for (const ledger of [true, false]) {
    const env = environment(true, ledger), projection = projectEnvironment(env);
    expect(projection.workload.children).toContainEqual({ kind: 'Secret', namespace: env.namespace, name: env.podName + '-admission' });
    expect(projection.volume).toBeUndefined();
    expect(projectEnvironment(environment(false, ledger)).workload.children.some((c) => c.name.endsWith('-admission'))).toBe(false);
    if (ledger) expect(projection.workload.render?.pod).toMatchObject({ developmentUsageProtection: { version: 1 }, expectedVolumeUid: env.native!.pvcUid,
      consumer: { id: env.render!.workloadConsumerId, taskId: env.native!.parentTaskId, revision: 1, purpose: 'agent', finalization: null } });
    else expect(projection.workload.render).toBeUndefined();
  }
});

test('both object constructors keep the UID gate ahead of all work and both disk stores', () => {
  for (const ledger of [true, false]) {
    const env = environment(true, ledger), pod = taskPodObject({ env, image: env.render!.image, envVars: {}, resources: env.render!.resources, envSecretName: runnerSecretOf(env), nodeName: env.native!.nodeName }, 10001);
    const spec = pod.spec as { initContainers?: Array<{ name: string; volumeMounts: unknown[] }>; volumes: unknown[]; containers: Array<{ env: unknown[]; volumeMounts: unknown[] }> };
    expect(pod.metadata.finalizers).toContain(WORKLOAD_STOP_FINALIZER);
    expect(pod.metadata.annotations).toMatchObject({ 'crewstation.io/workload-consumer': env.render!.workloadConsumerId, 'crewstation.io/work-volume-uid': env.native!.pvcUid });
    expect(spec.initContainers).toHaveLength(1);
    expect(spec.initContainers?.[0]).toMatchObject({ name: 'workload-admission', volumeMounts: [{ name: 'workload-admission', mountPath: '/run/admission', readOnly: true }] });
    expect(spec.volumes).toContainEqual({ name: 'development-usage', emptyDir: {} });
    expect(spec.volumes).toContainEqual({ name: 'development-usage-binding', emptyDir: {} });
    expect(spec.containers[0]!.env.filter((v) => (v as { name: string }).name === 'CS_RUNTIME_POD_UID')).toEqual([{ name: 'CS_RUNTIME_POD_UID', valueFrom: { fieldRef: { fieldPath: 'metadata.uid' } } }]);
  }
});

test('explicit incomplete or conflicting protection snapshots cannot silently become ordinary renders', () => {
  const env = environment(), bad: TaskEnvironment[] = [
    { ...env, render: { ...env.render!, developmentUsageProtection: { version: 2 } } as unknown as TaskEnvironment['render'] },
    { ...env, render: { ...env.render!, developmentUsageProtection: null } as unknown as TaskEnvironment['render'] },
    { ...env, render: { ...env.render!, developmentUsageProtection: { version: 1, extra: true } } as unknown as TaskEnvironment['render'] },
    { ...env, render: { ...env.render!, developmentUsageStorage: undefined } },
    { ...env, render: { ...env.render!, workloadConsumerId: undefined } },
    { ...env, render: { ...env.render!, start: 0 } },
    { ...env, render: { ...env.render!, completionPolicy: 'archive-and-delete' } },
    { ...env, businessWorkspace: { volumeUid: crypto.randomUUID(), phase: 'ready' } },
    { ...env, rebuildId: id(9) },
    { ...env, render: { ...env.render!, rebuild: { id: id(9), volumeUid: env.native!.pvcUid, intent: 'another-intent' } } },
    { ...env, render: { ...env.render!, businessStorage: { version: 1, ownerTaskId: env.id } } },
    { ...env, native: { ...env.native!, purpose: 'cli' } },
    { ...env, native: { ...env.native!, terminalId: 'old-terminal' } },
    { ...env, native: { ...env.native!, computeProfile: undefined } },
    { ...env, native: { ...env.native!, parentPodUid: '' } },
    { ...env, native: { ...env.native!, pvcUid: 'not-a-uid' } },
    { ...env, native: { ...env.native!, nodeName: '' } },
  ];
  for (const broken of bad) {
    expect(() => projectEnvironment(broken)).toThrow();
    expect(() => taskPodObject({ env: broken, image: env.render!.image, envVars: {}, resources: env.render!.resources, envSecretName: runnerSecretOf(env), nodeName: env.native!.nodeName }, 10001)).toThrow();
  }
});

test('the unprepared direct writer rejects a new choice before reads, writes or value material; the old digital writer still recovers', async () => {
  const k8s = createFakeK8sClient(), get = k8s.get.bind(k8s);
  let reads = 0, values = 0;
  k8s.get = async (...args) => { reads++; return get(...args); };
  const cluster = kubernetesNativeExecutions(k8s, 10001);
  await expect(cluster.prepare(environment(true, false), async () => { values++; return { CS_RUNNER_TOKEN: 'original-token' }; })).rejects.toThrow('持久启动许可');
  expect(reads).toBe(0); expect(values).toBe(0); expect(k8s.objects.size).toBe(0); expect(k8s.applied).toHaveLength(0); expect(k8s.deleted).toHaveLength(0);
  const old = environment(false, false), first = await cluster.prepare(old, async () => ({ CS_RUNNER_TOKEN: 'original-token' }));
  expect((await cluster.prepare(old, async () => { throw new Error('must retain original material'); })).podUid).toBe(first.podUid);
  expect((await k8s.get(Resources.Pod!, old.podName, old.namespace))?.metadata.finalizers).toBeUndefined();
});

async function claimFixture() {
  const database = await createTestDatabase([resourcesMigrations]), k8s = createFakeK8sClient(), env = environment();
  try {
    const resources = createResourcesModule({ db: database.db, quotas: { limitFor: async () => 4 }, authorizer: { projectAccess: async () => ({ operate: true }) }, isAdmin: async () => true });
    const projected = projectEnvironment(env).workload;
    await resources.api.owner('task-runtime').declare({ id: env.id, kind: projected.kind, ref: env.id, projectId: env.projectId, spec: { children: projected.children } });
    const current = env.podName + '-admission', old = env.podName + '-old-admission', oldUid = crypto.randomUUID(), currentUid = crypto.randomUUID();
    for (const [name, uid] of [[current, currentUid], [old, oldUid]]) await k8s.create({ ...secretObject({ name: name!, namespace: env.namespace, labels: { 'crewstation.io/task': env.id }, stringData: { podUid: 'original-bound-pod' } }), metadata: { ...secretObject({ name: name!, namespace: env.namespace, labels: { 'crewstation.io/task': env.id }, stringData: {} }).metadata, uid, creationTimestamp: '2026-09-30T16:00:00Z' } });
    let completed!: () => void;
    const removed = new Promise<void>((resolve) => { completed = resolve; }), remove = k8s.delete.bind(k8s);
    k8s.delete = async (ref, name, ns, options) => {
      const result = await remove(ref, name, ns, options);
      if (name === old) { expect(options?.preconditions?.uid).toBe(oldUid); completed(); }
      return result;
    };
    const ledger = resources.api, objects = () => [...k8s.objects.values()];
    const control = createClusterControlModule({ k8s, systemNamespace: 'cs-system', isAdmin: async () => true, clock: { now: () => env.createdAt },
      ledger: { ...ledger, listLive: () => ledger.list({}), children: (parentId) => ledger.list({ parentId, includeStopped: true }), adoptOrphanVolume: async () => {} },
      legacy: { resolveTaskId: async () => undefined, task: async (taskId) => taskId === env.id ? { kind: 'dev-session', state: 'running', execution: true, purpose: 'agent' } : undefined },
      feed: { start: () => {}, stop: async () => {}, synced: async () => {}, cached: (kind, ns, name) => objects().find((o) => o.kind === kind && o.metadata.namespace === ns && o.metadata.name === name), list: (kind) => objects().filter((o) => o.kind === kind) },
      orphanSweep: { firstDelayMs: 1, everyMs: 10, minAgeMs: 60_000 } });
    return { database, k8s, env, ledger, control, removed, current, currentUid, old };
  } catch (error) { await database.drop(); throw error; }
}

// The public controller's real sweep must finish; reconciliation alone is not a sweep receipt.
test.skipIf(!available)('actual projection -> PG claim -> public controller keeps the admission Secret while deleting its unclaimed predecessor', async () => {
  const f = await claimFixture(); let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    f.control.observer.start();
    await Promise.race([f.removed, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('actual orphan removal receipt missing')), 5_000); })]);
    expect(await f.ledger.claimOf({ kind: 'Secret', namespace: f.env.namespace, name: f.current, uid: f.currentUid })).toBe(f.env.id);
    expect((await f.k8s.get<K8sObject>(Resources.Secret!, f.current, f.env.namespace))?.metadata.uid).toBe(f.currentUid);
    expect(await f.k8s.get(Resources.Secret!, f.old, f.env.namespace)).toBeUndefined();
    expect(f.k8s.deleted.some((name) => name.endsWith('/' + f.current))).toBe(false);
    expect(f.control.stats().removed).toBe(1);
  } finally { if (timer) clearTimeout(timer); await f.control.observer.stop(); await f.database.drop(); }
}, 20_000);

// The new receipt selector rides the original projection spread; absence keeps the legacy object shape.
test('new receipt choice survives both original render paths and cannot stand alone or silently downgrade', () => {
  for (const ledger of [true, false]) {
    const env = environment(true, ledger), selected = { ...env, render: { ...env.render, ...(!ledger ? { execution: { workspacePod: 'original-parent', creator: 'native' as const } } : {}), developmentRemovalProtection: { version: 1 as const } } };
    expect(projectEnvironment(selected).workload.render?.pod).toMatchObject({ developmentRemovalProtection: { version: 1 } });
    expect(projectEnvironment(env).workload.render?.pod ?? {}).not.toHaveProperty('developmentRemovalProtection');
    for (const patch of [{ developmentUsageProtection: undefined }, { developmentRemovalProtection: null }, { developmentRemovalProtection: { version: 2 } }, { developmentRemovalProtection: { version: 1, extra: true } }]) {
      const broken = { ...selected, render: { ...selected.render, ...patch } } as unknown as TaskEnvironment;
      expect(() => projectEnvironment(broken)).toThrow();
    }
  }
});
