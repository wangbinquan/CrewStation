import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import type { BusinessStorageFinalization, ProjectId, ServiceId, TaskId } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { createFakeK8sClient } from '@crewstation/k8s';
import { newResourceId } from '@crewstation/kernel';
import { createResourcesModule, resourcesMigrations } from '@crewstation/module-resources';
import { queueMigrations } from '@crewstation/queue';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { createTaskRuntimeModule, taskRuntimeMigrations } from '../wiring';
import { drizzleUnitOfWork } from '../adapters/persistence/drizzleUnitOfWork';
import { archiveExecutionStore } from '../adapters/persistence/archiveExecutions';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('independent archive execution with PostgreSQL resource admission', () => {
  let tdb: TestDatabase;
  beforeAll(async () => { tdb = await createTestDatabase([eventbusMigrations, queueMigrations, resourcesMigrations, taskRuntimeMigrations]); });
  afterAll(async () => { await tdb?.drop(); });
  async function fixture(pending = false) {
    const projectId = newResourceId() as ProjectId, serviceId = newResourceId() as ServiceId, taskId = newResourceId() as TaskId, profileId = newResourceId(), k8s = createFakeK8sClient();
    let limit = 1;
    const resources = createResourcesModule({ db: tdb.db, quotas: { limitFor: async () => limit }, authorizer: { projectAccess: async () => ({ operate: true }) }, isAdmin: async () => true });
    const owner = resources.api.owner('task-runtime'), ledger = { within: (tx: unknown) => owner.within(tx as object), live: async () => (await resources.api.list({})).filter((r) => r.owner.module === 'task-runtime'), occupancy: resources.api.occupancy };
    const profile = { id: profileId, name: 'test', cpu: '1', memory: '1Gi', storage: '1Gi', description: '' }, closed: string[] = [], issued: string[] = [];
    const credentials = { bind: async () => {}, issue: async (input: { id: string }) => { issued.push(input.id); return { token: 'opaque-helper-token' }; }, close: async (id: string) => { closed.push(id); } };
    const make = () => createTaskRuntimeModule({ db: tdb.db, k8s, ledger, workloadSafety: resources.api.workloadSafety, taskVolumes: resources.api.taskVolumes, creation: 'ledger', archive: { credentials, apiUrl: 'http://api:8087' }, authorizer: { authorize: async () => {} }, isAdmin: async () => true,
      quotas: { quotaLimit: async () => limit }, profiles: { listTaskProfiles: async () => [profile], getTaskProfile: async () => profile },
      services: { resolveServiceById: async () => ({ projectId, namespace: 'cs-archive', slug: 'service', name: 'Service' }) },
      sources: { pinTaskImage: async () => `runtime@sha256:${'a'.repeat(64)}`, configEnv: async () => { throw new Error('archive must not request application config'); }, dataEnv: async () => { throw new Error('archive must not request database'); }, taskDataEnv: async () => { throw new Error('archive must not request task database'); } },
      settings: { taskImage: 'runtime:local', sessionUrl: 'ws://session', systemNamespace: 'cs-system', userDomain: 'localhost', serviceDomain: 'svc.localhost', workerUid: 10001, defaultProfile: profileId, userAuthMiddleware: 'auth', dropIdentityHeadersMiddleware: 'drop' },
    });
    const runtime = make();
    await runtime.api.createEnvironment({ serviceId, kind: 'business', volumeMode: 'persistent', businessStorage: 'isolated-v1', completionPolicy: 'archive-and-delete', admission: { id: taskId, fingerprint: 'a'.repeat(64) } });
    const input: BusinessStorageFinalization = { taskId, projectId, serviceId, operationId: newResourceId(), revision: 1, volumeUid: crypto.randomUUID() };
    const uow = drizzleUnitOfWork(tdb.db, { ledger }), original = (await uow.read.environments.getById(taskId))!;
    const volume = await resources.api.taskVolumes.forTask(taskId);
    await resources.api.taskVolumes.beginProvision(volume.resourceId);
    if (pending) await resources.api.taskVolumes.recordClaim(volume.resourceId, { namespace: original.namespace, name: original.pvcName, uid: input.volumeUid! });
    else await resources.api.taskVolumes.recordTarget(volume.resourceId, { kind: 'local-path', namespace: original.namespace, name: original.pvcName, uid: input.volumeUid!, pvName: 'pv', pvUid: 'pv-uid', nodeName: 'node', nodeUid: 'node-uid', root: '/volumes', directory: 'task-work' });
    // Parent stop/volume proof is produced by the independent stop fixture; this layer starts from that durable checkpoint.
    await resources.api.observe({ child: { kind: 'PersistentVolumeClaim', name: original.pvcName, namespace: original.namespace, uid: input.volumeUid!, phase: pending ? 'Pending' : 'Bound', ready: !pending } });
    await resources.api.workloadSafety.freezeTask(taskId, { operationId: input.operationId, revision: input.revision });
    await resources.api.workloadSafety.closeAdmission({ resourceId: taskId, namespace: original.namespace, podName: original.podName, consumer: { id: original.render!.workloadConsumerId!, taskId, revision: 1, purpose: 'business', finalization: null } });
    await resources.api.observeConditions(taskId, [{ type: 'WorkloadStopped', status: 'true', reason: original.render!.workloadConsumerId! }]);
    await uow.run(async (scope) => scope.environments.update({ ...original, state: 'releasing', release: { reason: 'business', occupied: false }, ...(!pending ? { businessWorkspace: { phase: 'paused' as const, volumeUid: input.volumeUid! } } : {}),
      render: { ...original.render!, storageFinalization: { operationId: input.operationId, revision: 1, volumeUid: input.volumeUid!, computeStopped: true } } }));
    return { runtime, make, input, resources, ledger, uow, store: archiveExecutionStore(tdb.db, ledger), original, issued, closed, setLimit: (value: number) => { limit = value; } };
  }
  test('replicas admit one distinct archive resource with one quota unit and no live parent Pod or business environment', async () => {
    const f = await fixture(); expect(await f.resources.api.occupancy(f.input.projectId)).toBe(0);
    const [a, b] = await Promise.all([f.runtime.api.archiveExecution!.ensure(f.input), f.make().api.archiveExecution!.ensure(f.input)]);
    expect(a).toEqual(b); expect(a.state).toBe('admitted'); expect(await f.resources.api.occupancy(f.input.projectId)).toBe(1);
    const record = (await f.resources.api.get(a.id))!;
    expect(record).toMatchObject({ kind: 'archive-execution', parentId: f.input.taskId, purpose: 'archive-helper', owner: { module: 'task-runtime' } });
    expect(record.spec).toMatchObject({ pod: { archive: { ownerTaskId: f.input.taskId }, pvc: f.original.pvcName, expectedVolumeUid: f.input.volumeUid } });
    expect(record.spec['pod']).not.toHaveProperty('workspace'); expect(record.spec['pod']).not.toHaveProperty('businessStorage');
    expect(await f.runtime.api.archiveExecution!.values(a.id)).toEqual({ CS_ARCHIVE_URL: `http://api:8087/internal/archive-helpers/${a.id}`, CS_ARCHIVE_TOKEN: 'opaque-helper-token' });
    await f.runtime.api.archiveExecution!.bind(a.id, 'pod-uid', 'secret-uid');
    await expect(f.runtime.api.archiveExecution!.values(a.id)).rejects.toMatchObject({ kind: 'precondition' });
    await expect(f.runtime.api.archiveExecution!.bind(a.id, 'other-pod', 'secret-uid')).rejects.toMatchObject({ kind: 'conflict' });
    expect((await f.store.get(a.id))?.podUid).toBe('pod-uid');
  });
  test('unbound PVC identity can drain the task; an empty archive uses a credential-free binding helper before sealing deletion', async () => {
    const f = await fixture(true), cleanup = f.runtime.api.storageCleanup!;
    expect(await f.runtime.api.resolveBusinessStorage({ ...f.input, volumeUid: null })).toBe(f.input.volumeUid);
    expect((await cleanup.prepare(f.input)).state).toBe('pending');
    const helper = (await f.store.active(f.input.taskId))!; expect(helper.purpose).toBe('binding');
    expect(await f.runtime.api.archiveExecution!.values(helper.id)).toEqual({}); expect(f.issued).toEqual([]);
    expect(await f.resources.api.occupancy(f.input.projectId)).toBe(1);
    expect((await f.resources.api.get(helper.id))?.spec).toMatchObject({ pod: { archive: { bindOnly: true }, expectedVolumeUid: f.input.volumeUid } });
    const volume = await f.resources.api.taskVolumes.forTask(f.input.taskId); expect(volume.permit).toBeNull();
    await f.resources.api.taskVolumes.recordTarget(volume.resourceId, { kind: 'local-path', namespace: f.original.namespace, name: f.original.pvcName, uid: f.input.volumeUid!, pvName: 'bound-pv', pvUid: 'bound-pv-uid', nodeName: 'node', nodeUid: 'node-uid', root: '/volumes', directory: 'new-work' });
    expect((await cleanup.prepare(f.input)).state).toBe('pending');
    await f.resources.api.observeConditions(helper.id, [{ type: 'WorkloadStopped', status: 'true', reason: helper.consumerId }]);
    expect((await cleanup.prepare(f.input)).state).toBe('complete');
    expect(f.closed).toEqual([]); expect(await f.resources.api.occupancy(f.input.projectId)).toBe(0);
    expect((await f.resources.api.taskVolumes.forTask(f.input.taskId)).target?.pvUid).toBe('bound-pv-uid');
  });
  test('quota pressure persists one queued intent and resumes that exact attempt after capacity returns', async () => {
    const f = await fixture(); f.setLimit(0);
    await expect(f.runtime.api.archiveExecution!.ensure(f.input)).rejects.toMatchObject({ kind: 'quota_exceeded' });
    const queued = (await f.store.active(f.input.taskId))!; expect(queued.state).toBe('queued'); expect(await f.resources.api.get(queued.id)).toBeUndefined();
    await expect(f.make().api.archiveExecution!.ensure(f.input)).rejects.toMatchObject({ kind: 'quota_exceeded' });
    expect((await f.store.active(f.input.taskId))!.id).toBe(queued.id);
    f.setLimit(1); expect(await f.make().api.archiveExecution!.ensure(f.input)).toEqual({ id: queued.id, state: 'admitted' });
    expect(await f.resources.api.occupancy(f.input.projectId)).toBe(1);
  });
  test('stop retains quota and credentials until durable consumer proof; no volume release is requested', async () => {
    const f = await fixture(), execution = await f.runtime.api.archiveExecution!.ensure(f.input), e = (await f.store.get(execution.id))!;
    expect(await f.runtime.api.archiveExecution!.stop(f.input)).toBe(false); expect(f.closed).toEqual([]);
    expect(await f.resources.api.occupancy(f.input.projectId)).toBe(1); expect(await f.resources.api.workloadSafety.admissionClosed(e.consumerId)).toBe(true);
    await expect(f.runtime.api.archiveExecution!.values(e.id)).rejects.toMatchObject({ kind: 'precondition' });
    await f.resources.api.observeConditions(e.id, [{ type: 'WorkloadStopped', status: 'true', reason: e.consumerId }]);
    expect(await f.make().api.archiveExecution!.stop(f.input)).toBe(true); expect(f.closed).toEqual([e.id]);
    expect((await f.store.get(e.id))?.state).toBe('stopped'); expect(await f.resources.api.occupancy(f.input.projectId)).toBe(0);
    const volume = await f.ledger.within(tdb.db).find(`${f.input.taskId}/work`, 'volume'); expect(volume?.desired).toBe('present');
    expect(await f.runtime.api.archiveExecution!.stop(f.input)).toBe(true);
    await expect(f.make().api.archiveExecution!.ensure(f.input)).rejects.toMatchObject({ details: { code: 'archive_retry_pending' } });
    expect(await f.resources.api.occupancy(f.input.projectId)).toBe(0);
    await tdb.db.execute(sql`UPDATE task_runtime.archive_executions SET body=jsonb_set(body,'{updatedAt}',to_jsonb('2000-01-01T00:00:00Z'::text)) WHERE id=${e.id}`);
    const retry = await f.make().api.archiveExecution!.ensure(f.input);
    expect(retry.id).not.toBe(e.id); expect(retry.state).toBe('admitted');
  });
  test('cross-task scope and changed finalization cannot borrow an active archive helper', async () => {
    const f = await fixture(); await f.runtime.api.archiveExecution!.ensure(f.input);
    await expect(f.runtime.api.archiveExecution!.ensure({ ...f.input, revision: 2 })).rejects.toMatchObject({ kind: 'conflict' });
    await expect(f.runtime.api.archiveExecution!.stop({ ...f.input, serviceId: newResourceId() as ServiceId })).rejects.toMatchObject({ kind: 'conflict' });
    expect(f.closed).toEqual([]); expect((await f.store.active(f.input.taskId))?.state).toBe('admitted');
  });
  test('final task release waits for the physical reclaim proof and is replayable after owner restart', async () => {
    const f = await fixture(), cleanup = f.runtime.api.storageCleanup!, stop = await cleanup.prepare(f.input);
    expect(stop.state).toBe('complete');
    const permit = { id: f.input.operationId, taskId: f.input.taskId, operationId: f.input.operationId, revision: 1, receiptId: newResourceId(), volumeUid: f.input.volumeUid, allConsumersStoppedDigest: stop.digest! };
    await cleanup.release(f.input, permit);
    expect(await cleanup.proof(f.input)).toBeNull();
    await expect(cleanup.complete(f.input, newResourceId())).rejects.toThrow();
    expect((await f.uow.read.environments.getById(f.input.taskId))?.state).toBe('releasing');
    const volume = await f.resources.api.taskVolumes.forTask(f.input.taskId);
    const proof = { id: newResourceId(), permitId: permit.id, volumeUid: f.input.volumeUid, pvUid: 'pv-uid', disposition: 'deleted' as const, storageReclaimed: true as const, source: 'local-path-probe' as const, observedAt: new Date().toISOString() };
    await f.resources.api.taskVolumes.recordReclaimed(volume.resourceId, proof);
    await f.make().api.storageCleanup!.complete(f.input, proof.id); await cleanup.complete(f.input, proof.id);
    expect((await f.uow.read.environments.getById(f.input.taskId))?.state).toBe('released');
    expect(await cleanup.proof(f.input)).toEqual(proof);
    await expect(f.runtime.api.archiveExecution!.ensure(f.input)).rejects.toThrow();
  });
  test('a task that never acquired an environment keeps a permanent admission tombstone and never claims reclaimed bytes', async () => {
    const f = await fixture(), input = { ...f.input, taskId: newResourceId() as TaskId, operationId: newResourceId(), volumeUid: null };
    await f.runtime.api.freezeBusinessStorage(input); await f.make().api.freezeBusinessStorage(input);
    expect(await f.uow.read.environments.getById(input.taskId)).toBeUndefined();
    expect((await f.runtime.api.stopBusinessStorage(input)).state).toBe('complete');
    const cleanup = f.make().api.storageCleanup!, barrier = await cleanup.prepare(input), volume = await f.resources.api.taskVolumes.forTask(input.taskId);
    expect(volume).toMatchObject({ provisionIssued: false, target: null, proof: null });
    expect((await f.resources.api.get(volume.resourceId))?.spec.children).toHaveLength(0);
    expect(await f.resources.api.occupancy(input.projectId)).toBe(0); expect(f.issued).toHaveLength(0);
    await expect(f.runtime.api.createEnvironment({ serviceId: input.serviceId, kind: 'business', volumeMode: 'persistent', completionPolicy: 'archive-and-delete', admission: { id: input.taskId, fingerprint: 'b'.repeat(64) } })).rejects.toThrow();
    await expect(f.resources.api.taskVolumes.beginProvision(volume.resourceId)).rejects.toThrow();
    await expect(f.make().api.freezeBusinessStorage({ ...input, serviceId: newResourceId() as ServiceId })).rejects.toThrow();
    const permit = { id: input.operationId, taskId: input.taskId, operationId: input.operationId, revision: 1, receiptId: newResourceId(), volumeUid: null, allConsumersStoppedDigest: barrier.digest! };
    await cleanup.release(input, permit); await expect(cleanup.complete(input, newResourceId())).rejects.toThrow();
    const proof = { id: newResourceId(), permitId: permit.id, volumeUid: null, pvUid: null, disposition: 'never-provisioned' as const, storageReclaimed: null, source: 'never-provisioned' as const, observedAt: new Date().toISOString() };
    await f.resources.api.taskVolumes.recordReclaimed(volume.resourceId, proof);
    await cleanup.complete(input, proof.id); await f.make().api.storageCleanup!.complete(input, proof.id);
    expect(await cleanup.proof(input)).toEqual(proof);
    expect((await f.resources.api.get(volume.resourceId))?.phase).toBe('stopped');
  });
  test('missing environment with an existing resource declaration or known volume is never converted to never-provisioned', async () => {
    const f = await fixture(), taskId = newResourceId() as TaskId, input = { ...f.input, taskId, volumeUid: null };
    await f.ledger.within(tdb.db).declare({ id: taskId, kind: 'business-workspace', ref: taskId, projectId: input.projectId, spec: { children: [] } });
    await expect(f.runtime.api.freezeBusinessStorage(input)).rejects.toMatchObject({ kind: 'precondition' });
    await expect(f.runtime.api.freezeBusinessStorage({ ...input, taskId: newResourceId() as TaskId, volumeUid: crypto.randomUUID() })).rejects.toMatchObject({ kind: 'precondition' });
    await expect(f.resources.api.taskVolumes.forTask(taskId)).rejects.toMatchObject({ kind: 'not_found' });
  });
  test('a late create receipt resolves the original UID after freeze, while an ambiguous create cannot become never-provisioned', async () => {
    const f = await fixture(), taskId = newResourceId() as TaskId, input = { ...f.input, taskId, operationId: newResourceId(), volumeUid: null };
    await f.runtime.api.createEnvironment({ serviceId: input.serviceId, kind: 'business', volumeMode: 'persistent', businessStorage: 'isolated-v1', completionPolicy: 'archive-and-delete', admission: { id: taskId, fingerprint: 'c'.repeat(64) } });
    const env = (await f.uow.read.environments.getById(taskId))!, volume = await f.resources.api.taskVolumes.forTask(taskId);
    await f.resources.api.taskVolumes.beginProvision(volume.resourceId);
    await expect(f.runtime.api.resolveBusinessStorage(input)).rejects.toMatchObject({ details: { code: 'workspace_volume_identity_pending' } });
    await expect(f.resources.api.taskVolumes.beginProvision(volume.resourceId)).rejects.toThrow();
    const uid = crypto.randomUUID();
    await f.resources.api.taskVolumes.recordTarget(volume.resourceId, { kind: 'local-path', namespace: env.namespace, name: env.pvcName, uid, pvName: 'late-pv', pvUid: 'late-pv-uid', nodeName: 'node', nodeUid: 'node-uid', root: '/volumes', directory: 'late-task' });
    expect(await f.make().api.resolveBusinessStorage(input)).toBe(uid);
    expect((await f.uow.read.environments.getById(taskId))!.render?.storageFinalization?.volumeUid).toBe(uid);
    expect(await f.make().api.resolveBusinessStorage({ ...input, volumeUid: uid })).toBe(uid);
    await expect(f.runtime.api.resolveBusinessStorage({ ...input, volumeUid: crypto.randomUUID() })).rejects.toMatchObject({ kind: 'conflict' });
    await expect(f.runtime.api.stopBusinessStorage(input)).rejects.toMatchObject({ kind: 'conflict' });
    expect((await f.resources.api.taskVolumes.forTask(taskId)).permit).toBeNull();
  });
});
