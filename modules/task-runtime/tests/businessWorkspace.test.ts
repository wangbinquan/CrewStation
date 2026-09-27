import { sql } from 'drizzle-orm';
import type { Worker } from '@crewstation/queue';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { ProjectId, ServiceId, TaskId, TraceId } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import type { K8sObject } from '@crewstation/k8s';
import { createFakeK8sClient, Resources } from '@crewstation/k8s';
import { createResourcesModule, resourcesMigrations } from '@crewstation/module-resources';
import { newResourceId } from '@crewstation/kernel';
import { queueMigrations } from '@crewstation/queue';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { createTaskRuntimeModule, taskRuntimeMigrations } from '../wiring';
import { drizzleUnitOfWork } from '../adapters/persistence/drizzleUnitOfWork';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-027 business workspace safe pause and original-volume resume', () => {
  let tdb: TestDatabase;
  beforeAll(async () => { tdb = await createTestDatabase([eventbusMigrations, queueMigrations, resourcesMigrations, taskRuntimeMigrations]); });
  afterAll(async () => { await tdb?.drop(); });
  const fixture = async () => {
    const projectId = newResourceId() as ProjectId, serviceId = newResourceId() as ServiceId, profileId = newResourceId(), k8s = createFakeK8sClient();
    const resources = createResourcesModule({ db: tdb.db, quotas: { limitFor: async () => 4 }, authorizer: { projectAccess: async () => ({ operate: true }) }, isAdmin: async () => true });
    const owner = resources.api.owner('task-runtime'), ledger = { within: (tx: unknown) => owner.within(tx as object), live: async () => (await resources.api.list({})).filter((record) => record.owner.module === 'task-runtime'), occupancy: resources.api.occupancy };
    const profile = { id: profileId, name: 'task', cpu: '1', memory: '1Gi', storage: '1Gi', description: '' };
    const make = (taskImage = 'test:runtime') => createTaskRuntimeModule({ db: tdb.db, k8s, ledger, creation: 'ledger', authorizer: { authorize: async () => {} }, isAdmin: async () => true,
      quotas: { quotaLimit: async () => 4 }, profiles: { devSessionProfile: async () => undefined, listTaskProfiles: async () => [profile], getTaskProfile: async () => profile },
      services: { resolveServiceById: async () => ({ projectId, namespace: 'cs-business-test', slug: 'business', name: 'business' }) },
      sources: { configEnv: async () => ({}), dataEnv: async () => ({}), taskDataEnv: async () => ({}) },
      settings: { taskImage, sessionUrl: 'ws://session', systemNamespace: 'cs-system', userDomain: 'localhost', serviceDomain: 'svc.localhost', workerUid: 10001, defaultProfile: profileId, userAuthMiddleware: 'auth', dropIdentityHeadersMiddleware: 'drop' },
    });
    const runtime = make(), task = await runtime.api.createEnvironment({ serviceId, kind: 'business', volumeMode: 'persistent', businessStorage: 'isolated-v1', admission: { id: newResourceId() as TaskId, fingerprint: 'a'.repeat(64) } });
    const env = (await drizzleUnitOfWork(tdb.db).read.environments.getById(task.id))!;
    const values = await runtime.api.runnerValues(task.id);
    const volume = await k8s.create<K8sObject>({ apiVersion: 'v1', kind: 'PersistentVolumeClaim', metadata: { name: env.pvcName, namespace: env.namespace, labels: { 'crewstation.io/task': task.id } }, spec: { accessModes: ['ReadWriteOnce'] }, status: { phase: 'Bound' } });
    const pod = await k8s.create<K8sObject>({ apiVersion: 'v1', kind: 'Pod', metadata: { name: task.podName, namespace: env.namespace, labels: { 'crewstation.io/task': task.id } }, spec: { nodeName: 'test-node', volumes: [{ name: 'work', persistentVolumeClaim: { claimName: env.pvcName } }] }, status: { phase: 'Running' } });
    await runtime.api.bindWorkload(task.id, pod.metadata.uid!);
    expect(await runtime.api.onRunnerConnected(task.id, values['CS_RUNNER_TOKEN']!)).toBe(true);
    return { runtime, make, task, env, values, pod, volume, resources, projectId, k8s };
  };

  test('delete acceptance retains quota; restart reconciles actual disappearance before one release, resume pins original volume', async () => {
    const f = await fixture(), remove = f.k8s.delete;
    f.k8s.delete = async (ref, name, namespace, options) => ref.kind === 'Pod' ? true : remove(ref, name, namespace, options);
    expect((await f.runtime.api.getEnvironment(f.task.id))?.businessWorkspace).toEqual({ phase: 'ready', volumeUid: f.volume.metadata.uid! });
    const requested = await f.runtime.api.pauseEnvironment(f.task.id);
    expect(requested).toMatchObject({ state: 'running', connected: false, businessWorkspace: { phase: 'pausing' } });
    expect(await f.resources.api.occupancy(f.projectId)).toBe(1);
    expect(await f.runtime.api.onRunnerConnected(f.task.id, f.values['CS_RUNNER_TOKEN']!)).toBe(false);
    f.k8s.delete = remove;
    await f.make().api.reconcile();
    expect((await f.runtime.api.getEnvironment(f.task.id))?.state).toBe('paused');
    expect(await f.resources.api.occupancy(f.projectId)).toBe(0);
    await f.runtime.api.pauseEnvironment(f.task.id); expect(await f.resources.api.occupancy(f.projectId)).toBe(0);
    const results = await Promise.all([f.runtime.api.resumeEnvironment(f.task.id), f.make().api.resumeEnvironment(f.task.id)]);
    expect(results.every((env) => env.state === 'creating')).toBe(true); expect(await f.resources.api.occupancy(f.projectId)).toBe(1);
    const workload = (await f.resources.api.get(f.task.id))!;
    expect(workload.spec['pod']).toMatchObject({ expectedVolumeUid: f.volume.metadata.uid!, businessStorage: { initialize: false } });
    const volume = (await f.resources.api.list({ parentId: f.task.id, kind: 'volume' }))[0]!;
    expect(volume.conditions.find((c) => c.type === 'Provisioning')?.status).toBe('false');
    expect(await f.k8s.get(Resources.PersistentVolumeClaim!, f.env.pvcName, f.env.namespace)).toEqual(f.volume);
  });

  test('close keeps quota through unconfirmed deletion even before the resource watcher has observed the Pod', async () => {
    const f = await fixture(), remove = f.k8s.delete;
    f.k8s.delete = async (ref, name, namespace, options) => ref.kind === 'Pod' ? true : remove(ref, name, namespace, options);
    const closing = await f.runtime.api.releaseEnvironment(f.task.id, 'business'); expect(closing.state).toBe('releasing');
    expect(await f.resources.api.occupancy(f.projectId)).toBe(1);
    const worker = f.runtime.workers[1] as Worker;
    await worker.runOnce();
    expect((await f.runtime.api.getEnvironment(f.task.id))?.state).toBe('releasing');
    expect(await f.resources.api.occupancy(f.projectId)).toBe(1);
    f.k8s.delete = remove;
    await tdb.db.execute(sql`UPDATE platform_infra.jobs SET run_at=now()-interval '1 second'`);
    await worker.runOnce();
    expect((await f.runtime.api.getEnvironment(f.task.id))?.state).toBe('released');
    expect(await f.resources.api.occupancy(f.projectId)).toBe(0);
    expect(await f.k8s.get(Resources.PersistentVolumeClaim!, f.env.pvcName, f.env.namespace)).toEqual(f.volume);
  });

  test('an active Agent prevents pause and a pausing workspace rejects new Agent admission', async () => {
    const f = await fixture(), input = { id: newResourceId() as TaskId, parentTaskId: f.task.id, purpose: 'subtask' as const, agentId: 'agent', runnerId: newResourceId(), fingerprint: 'attempt' };
    await f.runtime.api.createNativeExecution(input);
    await expect(f.runtime.api.pauseEnvironment(f.task.id)).rejects.toMatchObject({ kind: 'conflict', details: { code: 'active_subtasks' } });
    expect((await f.runtime.api.getEnvironment(f.task.id))?.state).toBe('running');
    expect(await f.resources.api.occupancy(f.projectId)).toBe(2);
    const other = await fixture(), remove = other.k8s.delete;
    other.k8s.delete = async (ref, name, namespace, options) => ref.kind === 'Pod' ? true : remove(ref, name, namespace, options);
    await other.runtime.api.pauseEnvironment(other.task.id);
    await expect(other.runtime.api.createNativeExecution({ ...input, id: newResourceId() as TaskId, parentTaskId: other.task.id })).rejects.toMatchObject({ kind: 'precondition' });
    expect(await other.resources.api.occupancy(other.projectId)).toBe(1);
  });

  test('missing, replaced, foreign or deleting volume cannot resume or acquire quota; no empty replacement is created', async () => {
    const f = await fixture(); await f.runtime.api.pauseEnvironment(f.task.id);
    const before = f.k8s.objects.size;
    await f.k8s.delete(Resources.PersistentVolumeClaim!, f.env.pvcName, f.env.namespace);
    await expect(f.runtime.api.resumeEnvironment(f.task.id)).rejects.toMatchObject({ details: { code: 'workspace_volume_changed' } });
    const replacement = { ...f.volume, metadata: { ...f.volume.metadata, uid: 'replacement' } };
    await f.k8s.create(replacement);
    await expect(f.runtime.api.resumeEnvironment(f.task.id)).rejects.toMatchObject({ details: { code: 'workspace_volume_changed' } });
    expect(await f.resources.api.occupancy(f.projectId)).toBe(0); expect(f.k8s.objects.size).toBe(before);
    expect((await f.runtime.api.getEnvironment(f.task.id))?.state).toBe('paused');
  });
  test('fixed admission cancellation serializes with late create and preserves existing runtime quota', async () => {
    const f = await fixture(), id = newResourceId() as TaskId;
    expect(await f.runtime.api.blockBusinessAdmission(f.env.serviceId, id)).toBe(true);
    expect(await f.make().api.blockBusinessAdmission(f.env.serviceId, id)).toBe(true);
    await expect(f.runtime.api.createEnvironment({ serviceId: f.env.serviceId, kind: 'business', admission: { id, fingerprint: 'b'.repeat(64) } })).rejects.toMatchObject({ details: { code: 'admission_cancelled' } });
    await expect(f.runtime.api.createNativeExecution({ id, parentTaskId: f.task.id, purpose: 'subtask', agentId: 'blocked-agent', runnerId: id, fingerprint: 'blocked' })).rejects.toMatchObject({ details: { code: 'admission_cancelled' } });
    expect(await f.runtime.api.getEnvironment(id)).toBeUndefined();
    expect(await f.resources.api.occupancy(f.projectId)).toBe(1);
    expect(await f.runtime.api.blockBusinessAdmission(f.env.serviceId, f.task.id)).toBe(false);
    const raceId = newResourceId() as TaskId;
    const [stop, create] = await Promise.allSettled([
      f.runtime.api.blockBusinessAdmission(f.env.serviceId, raceId),
      f.runtime.api.createEnvironment({ serviceId: f.env.serviceId, kind: 'business', admission: { id: raceId, fingerprint: 'c'.repeat(64) } }),
    ]);
    expect(stop.status).toBe('fulfilled');
    if (stop.status === 'fulfilled' && stop.value) expect(create.status).toBe('rejected');
    else { expect(create.status).toBe('fulfilled'); expect(await f.runtime.api.getEnvironment(raceId)).toBeDefined(); }
  });

  test('恢复检查只读核对原工作区；同名终态或删除中 Pod 也不能当作已停止', async () => {
    const f = await fixture(), input = { projectId: f.projectId, serviceId: f.env.serviceId, taskId: f.task.id };
    const before = await drizzleUnitOfWork(tdb.db).read.environments.getById(f.task.id), objects = [...f.k8s.objects.values()];
    expect(await f.runtime.api.inspectBusinessRecovery(input)).toMatchObject({ state: 'running', persistent: true, stopped: false, volumeVerified: true, volumeUid: f.volume.metadata.uid, image: 'test:runtime', activeChildren: false });
    expect(await drizzleUnitOfWork(tdb.db).read.environments.getById(f.task.id)).toEqual(before);
    expect([...f.k8s.objects.values()]).toEqual(objects);
    expect(await f.runtime.api.inspectBusinessRecovery({ ...input, serviceId: newResourceId() as ServiceId })).toBeUndefined();
    expect(await f.runtime.api.inspectBusinessRecovery({ ...input, projectId: newResourceId() as ProjectId })).toBeUndefined();
    expect(await f.runtime.api.inspectBusinessRecovery({ ...input, taskId: newResourceId() as TaskId })).toBeUndefined();
    await f.k8s.apply({ ...f.pod, status: { phase: 'Failed' } });
    expect((await f.runtime.api.inspectBusinessRecovery(input))?.stopped).toBe(false);
    await f.k8s.apply({ ...f.pod, metadata: { ...f.pod.metadata, deletionTimestamp: new Date().toISOString() } });
    expect((await f.runtime.api.inspectBusinessRecovery(input))?.stopped).toBe(false);
    await f.runtime.api.pauseEnvironment(f.task.id);
    expect(await f.runtime.api.inspectBusinessRecovery(input)).toMatchObject({ state: 'paused', stopped: true, volumeVerified: true, activeChildren: false });
    expect(await f.resources.api.occupancy(f.projectId)).toBe(0);
  });

  test('恢复检查拒绝丢失、换UID、外来、未Bound、删除中的卷；读取错误没有停止证明', async () => {
    const f = await fixture(), input = { projectId: f.projectId, serviceId: f.env.serviceId, taskId: f.task.id };
    await f.runtime.api.pauseEnvironment(f.task.id);
    const original = f.volume;
    for (const changed of [
      { ...original, metadata: { ...original.metadata, uid: 'replacement' } },
      { ...original, metadata: { ...original.metadata, labels: { 'crewstation.io/task': newResourceId() } } },
      { ...original, status: { phase: 'Pending' } },
      { ...original, metadata: { ...original.metadata, deletionTimestamp: new Date().toISOString() } },
    ]) {
      await f.k8s.delete(Resources.PersistentVolumeClaim!, f.env.pvcName, f.env.namespace);
      await f.k8s.create(changed);
      expect(await f.runtime.api.inspectBusinessRecovery(input)).toMatchObject({ volumeVerified: false, volumeUid: original.metadata.uid });
    }
    await f.k8s.delete(Resources.PersistentVolumeClaim!, f.env.pvcName, f.env.namespace);
    expect(await f.runtime.api.inspectBusinessRecovery(input)).toMatchObject({ stopped: true, volumeVerified: false });
    const get = f.k8s.get;
    f.k8s.get = async () => { throw new Error('cluster unavailable'); };
    await expect(f.runtime.api.inspectBusinessRecovery(input)).rejects.toThrow('cluster unavailable');
    f.k8s.get = get;
    expect(await f.resources.api.occupancy(f.projectId)).toBe(0);
  });

  test('恢复检查会发现活动子环境，查询不触发回收', async () => {
    const f = await fixture();
    const child = await f.runtime.api.createNativeExecution({ id: newResourceId() as TaskId, parentTaskId: f.task.id, purpose: 'subtask', agentId: 'recovery-child', runnerId: newResourceId(), fingerprint: 'recovery-child' });
    expect(await f.runtime.api.inspectBusinessRecovery({ projectId: f.projectId, serviceId: f.env.serviceId, taskId: f.task.id })).toMatchObject({ activeChildren: true, stopped: false });
    expect(await f.runtime.api.inspectBusinessRecovery({ projectId: f.projectId, serviceId: f.env.serviceId, taskId: child.id })).toBeUndefined();
    expect(await f.resources.api.occupancy(f.projectId)).toBe(2);
    expect((await f.runtime.api.getEnvironment(child.id))?.native?.state).toBe('queued');
    const uow = drizzleUnitOfWork(tdb.db), env = (await uow.read.environments.getById(child.id))!;
    await uow.run((s) => s.environments.update({ ...env, native: { ...env.native!, state: 'finished' } }));
    await f.k8s.create({ apiVersion: 'v1', kind: 'Pod', metadata: { name: env.podName, namespace: env.namespace }, status: { phase: 'Failed' } });
    expect((await f.runtime.api.inspectBusinessRecovery({ projectId: f.projectId, serviceId: f.env.serviceId, taskId: f.task.id }))?.activeChildren).toBe(true);
    await f.k8s.delete(Resources.Pod!, env.podName, env.namespace);
    expect((await f.runtime.api.inspectBusinessRecovery({ projectId: f.projectId, serviceId: f.env.serviceId, taskId: f.task.id }))?.activeChildren).toBe(false);
  });

  test('读取集群期间工作区发生变化，丢弃旧检查结果', async () => {
    const f = await fixture(), get = f.k8s.get, uow = drizzleUnitOfWork(tdb.db);
    f.k8s.get = async (...args) => {
      if (args[0].kind === 'Pod') {
        const env = (await uow.read.environments.getById(f.task.id))!;
        await uow.run((s) => s.environments.update({ ...env, connected: !env.connected }));
      }
      return get(...args);
    };
    await expect(f.runtime.api.inspectBusinessRecovery({ projectId: f.projectId, serviceId: f.env.serviceId, taskId: f.task.id })).rejects.toMatchObject({ details: { code: 'workspace_changed' } });
  });

  test('失败工作区重建固定原卷和镜像；跨实例重放只启动一次，旧世代不能重启后续失败', async () => {
    const f = await fixture(), uow = drizzleUnitOfWork(tdb.db);
    await f.runtime.api.markFailed(f.task.id, 'fixture failure');
    const input = { projectId: f.projectId, serviceId: f.env.serviceId, taskId: f.task.id, operationId: newResourceId(), generation: 2, volumeUid: f.volume.metadata.uid! };
    await expect(f.runtime.api.rebuildBusinessWorkspace(input)).rejects.toMatchObject({ details: { code: 'workspace_cleanup_pending' } });
    expect(await f.k8s.get(Resources.Pod!, f.task.podName, f.env.namespace)).toEqual(f.pod);
    await f.k8s.delete(Resources.Pod!, f.task.podName, f.env.namespace);
    const original = (await uow.read.environments.getById(f.task.id))!;
    const results = await Promise.all([f.runtime.api.rebuildBusinessWorkspace(input), f.make('new-default:ignored').api.rebuildBusinessWorkspace(input)]);
    expect(results.map((r) => r.state)).toEqual(['creating', 'creating']);
    const rebuilt = (await uow.read.environments.getById(f.task.id))!;
    expect(rebuilt.render).toMatchObject({ image: original.render!.image, resources: original.render!.resources, start: original.render!.start + 1, businessRecovery: { operationId: input.operationId, generation: 2, volumeUid: input.volumeUid } });
    expect(rebuilt.runtimeInitialization).toBeUndefined(); expect(rebuilt.podUid).toBeUndefined();
    expect(rebuilt.runnerTokenHash).not.toBe(original.runnerTokenHash);
    expect(await f.resources.api.occupancy(f.projectId)).toBe(1);
    expect((await f.resources.api.get(f.task.id))!.spec['pod']).toMatchObject({ expectedVolumeUid: input.volumeUid, businessStorage: { initialize: false } });
    await expect(f.runtime.api.rebuildBusinessWorkspace({ ...input, generation: 99 })).rejects.toMatchObject({ details: { code: 'idempotency_conflict' } });
    await expect(f.runtime.api.rebuildBusinessWorkspace({ ...input, volumeUid: 'replacement' })).rejects.toMatchObject({ details: { code: 'idempotency_conflict' } });
    await f.runtime.api.markFailed(f.task.id, 'rebuild startup failed');
    expect((await f.make().api.rebuildBusinessWorkspace(input)).state).toBe('failed');
    expect((await uow.read.environments.getById(f.task.id))!.render!.start).toBe(rebuilt.render!.start);
    expect(await f.resources.api.occupancy(f.projectId)).toBe(0);
    await f.runtime.api.rebuildBusinessWorkspace({ ...input, operationId: newResourceId(), generation: 3 });
    await f.runtime.api.markFailed(f.task.id, 'second rebuild failed');
    await expect(f.runtime.api.rebuildBusinessWorkspace(input)).rejects.toMatchObject({ details: { code: 'stale_generation' } });
    expect(await f.k8s.get(Resources.PersistentVolumeClaim!, f.env.pvcName, f.env.namespace)).toEqual(f.volume);
    expect(await f.resources.api.occupancy(f.projectId)).toBe(0);
  });

  test('重建要求原卷身份、业务归属、明确失败状态与子环境停止，不创建替代卷', async () => {
    const f = await fixture(), input = { projectId: f.projectId, serviceId: f.env.serviceId, taskId: f.task.id, operationId: newResourceId(), generation: 2, volumeUid: f.volume.metadata.uid! };
    await expect(f.runtime.api.rebuildBusinessWorkspace(input)).rejects.toMatchObject({ kind: 'precondition' });
    const child = await f.runtime.api.createNativeExecution({ id: newResourceId() as TaskId, parentTaskId: f.task.id, purpose: 'subtask', agentId: 'active', runnerId: newResourceId(), fingerprint: 'active' });
    await f.runtime.api.markFailed(f.task.id, 'fixture failure'); await f.k8s.delete(Resources.Pod!, f.task.podName, f.env.namespace);
    await expect(f.runtime.api.rebuildBusinessWorkspace({ ...input, serviceId: newResourceId() as ServiceId })).rejects.toMatchObject({ kind: 'not_found' });
    await expect(f.runtime.api.rebuildBusinessWorkspace({ ...input, volumeUid: 'wrong-volume' })).rejects.toMatchObject({ details: { code: 'workspace_volume_changed' } });
    await expect(f.runtime.api.rebuildBusinessWorkspace(input)).rejects.toMatchObject({ details: { code: 'active_subtasks' } });
    expect((await f.runtime.api.getEnvironment(child.id))?.native?.state).toBe('queued');
    await f.k8s.delete(Resources.PersistentVolumeClaim!, f.env.pvcName, f.env.namespace);
    await expect(f.runtime.api.rebuildBusinessWorkspace(input)).rejects.toMatchObject({ details: { code: 'workspace_volume_changed' } });
    expect(await f.k8s.get(Resources.PersistentVolumeClaim!, f.env.pvcName, f.env.namespace)).toBeUndefined();
  });

  test('原卷不可用时固定材料创建新任务，并发重放不重复准入或改写旧任务', async () => {
    const f = await fixture(), uow = drizzleUnitOfWork(tdb.db);
    await f.runtime.api.markFailed(f.task.id, 'lost workspace');
    await f.k8s.delete(Resources.Pod!, f.task.podName, f.env.namespace);
    const input = { projectId: f.projectId, serviceId: f.env.serviceId, taskId: f.task.id, newTaskId: newResourceId() as TaskId, fingerprint: 'd'.repeat(64), traceId: 'a'.repeat(32) as TraceId };
    await expect(f.runtime.api.restartBusinessWorkspace(input)).rejects.toMatchObject({ details: { code: 'original_workspace_available' } });
    await f.k8s.delete(Resources.PersistentVolumeClaim!, f.env.pvcName, f.env.namespace);
    const original = (await uow.read.environments.getById(f.task.id))!;
    const result = await Promise.all([f.runtime.api.restartBusinessWorkspace(input), f.make('new-default:ignored').api.restartBusinessWorkspace(input)]);
    expect(result.map((r) => r.id)).toEqual([input.newTaskId, input.newTaskId]);
    const restarted = (await uow.read.environments.getById(input.newTaskId))!;
    expect(restarted).toMatchObject({ state: 'creating', projectId: f.projectId, serviceId: f.env.serviceId, profile: original.profile, volumeMode: original.volumeMode, traceId: input.traceId });
    expect(restarted.render).toEqual({ image: original.render!.image, resources: original.render!.resources, workerUid: original.render!.workerUid, start: 1, businessStorage: { version: 1, ownerTaskId: input.newTaskId } });
    expect(restarted.runnerTokenHash).not.toBe(original.runnerTokenHash);
    expect(restarted.pvcName).not.toBe(original.pvcName); expect(restarted.podName).not.toBe(original.podName);
    expect(restarted.businessWorkspace).toBeUndefined(); expect(restarted.runtimeInitialization).toBeUndefined();
    expect(await uow.read.environments.getById(f.task.id)).toEqual(original);
    expect(await f.resources.api.occupancy(f.projectId)).toBe(1);
    expect((await f.resources.api.get(input.newTaskId))!.spec['pod']).toMatchObject({ image: original.render!.image, businessStorage: { initialize: true } });
    await f.runtime.api.markFailed(input.newTaskId, 'new startup failure');
    expect((await f.make().api.restartBusinessWorkspace(input)).state).toBe('failed');
    expect(await f.resources.api.occupancy(f.projectId)).toBe(0);
    await expect(f.runtime.api.restartBusinessWorkspace({ ...input, fingerprint: 'e'.repeat(64) })).rejects.toMatchObject({ kind: 'conflict' });
    await expect(f.runtime.api.restartBusinessWorkspace({ ...input, projectId: newResourceId() as ProjectId })).rejects.toMatchObject({ kind: 'conflict' });
  });

  test('重新执行确认旧进程停止及来源稳定，拒绝跨业务和复用原ID', async () => {
    const f = await fixture();
    const input = { projectId: f.projectId, serviceId: f.env.serviceId, taskId: f.task.id, newTaskId: newResourceId() as TaskId, fingerprint: 'e'.repeat(64), traceId: 'b'.repeat(32) as TraceId };
    await expect(f.runtime.api.restartBusinessWorkspace(input)).rejects.toMatchObject({ kind: 'precondition' });
    await expect(f.runtime.api.restartBusinessWorkspace({ ...input, newTaskId: f.task.id })).rejects.toMatchObject({ kind: 'validation' });
    await expect(f.runtime.api.restartBusinessWorkspace({ ...input, serviceId: newResourceId() as ServiceId })).rejects.toMatchObject({ kind: 'not_found' });
    await f.runtime.api.markFailed(f.task.id, 'failed');
    await expect(f.runtime.api.restartBusinessWorkspace(input)).rejects.toMatchObject({ details: { code: 'workspace_cleanup_pending' } });
    expect(await f.k8s.get(Resources.Pod!, f.task.podName, f.env.namespace)).toEqual(f.pod);
    await f.k8s.delete(Resources.Pod!, f.task.podName, f.env.namespace);
    await f.k8s.delete(Resources.PersistentVolumeClaim!, f.env.pvcName, f.env.namespace);
    const get = f.k8s.get, uow = drizzleUnitOfWork(tdb.db);
    f.k8s.get = async (...args) => {
      if (args[0].kind === 'Pod') {
        const env = (await uow.read.environments.getById(f.task.id))!;
        await uow.run((s) => s.environments.update({ ...env, connected: true }));
      }
      return get(...args);
    };
    await expect(f.runtime.api.restartBusinessWorkspace(input)).rejects.toMatchObject({ details: { code: 'workspace_changed' } });
    expect(await f.runtime.api.getEnvironment(input.newTaskId)).toBeUndefined();
    expect(await f.resources.api.occupancy(f.projectId)).toBe(0);
  });
});
