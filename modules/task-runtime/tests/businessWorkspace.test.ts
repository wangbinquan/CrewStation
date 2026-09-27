import { sql } from 'drizzle-orm';
import type { Worker } from '@crewstation/queue';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { ProjectId, ServiceId, TaskId } from '@crewstation/contracts';
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
    const make = () => createTaskRuntimeModule({ db: tdb.db, k8s, ledger, creation: 'ledger', authorizer: { authorize: async () => {} }, isAdmin: async () => true,
      quotas: { quotaLimit: async () => 4 }, profiles: { devSessionProfile: async () => undefined, listTaskProfiles: async () => [profile], getTaskProfile: async () => profile },
      services: { resolveServiceById: async () => ({ projectId, namespace: 'cs-business-test', slug: 'business', name: 'business' }) },
      sources: { configEnv: async () => ({}), dataEnv: async () => ({}), taskDataEnv: async () => ({}) },
      settings: { taskImage: 'test:runtime', sessionUrl: 'ws://session', systemNamespace: 'cs-system', userDomain: 'localhost', serviceDomain: 'svc.localhost', workerUid: 10001, defaultProfile: profileId, userAuthMiddleware: 'auth', dropIdentityHeadersMiddleware: 'drop' },
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

});
