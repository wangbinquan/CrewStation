import { afterEach, describe, expect, test } from 'bun:test';
import type { TaskId } from '@crewstation/contracts';
import type { K8sObject } from '@crewstation/k8s';
import { Resources } from '@crewstation/k8s';
import { newResourceId } from '@crewstation/kernel';
import type { Worker } from '@crewstation/queue';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import type { CreateNativeExecutionInput } from '../api/moduleApi';
import { NATIVE_EXECUTION_JOB_KIND } from '../ports/repositories';
import { developmentWorkloadFixture } from './developmentWorkloadFixture';
import type { DevelopmentWorkloadFixture } from './developmentWorkloadFixture';

const available = await testDatabaseAvailable();
let f: DevelopmentWorkloadFixture | undefined;
afterEach(async () => { await f?.close(); f = undefined; });

async function setup(mode: 'native' | 'ledger' = 'native') {
  f = await developmentWorkloadFixture(mode);
  await f.k8s.mergePatch(Resources.PersistentVolumeClaim!, f.parent.pvcName, f.parent.namespace,
    { status: { phase: 'Bound', capacity: { storage: '10Gi' } } });
  return f;
}
function legacy(purpose: 'cli' | 'agent'): CreateNativeExecutionInput {
  const { developmentUsageProtection: _protection, developmentUsageStorage: _storage, ...input } = f!.request();
  return { ...input, purpose };
}
async function admitLegacy(purpose: 'cli' | 'agent') {
  const accepted = await f!.runtime.api.createNativeExecution(legacy(purpose));
  return f!.load(accepted.id);
}
async function snapshot() {
  const tasks = await f!.tdb.db.execute(sql`SELECT count(*)::int AS count FROM task_runtime.environments`);
  const jobs = await f!.tdb.db.execute(sql`SELECT count(*)::int AS count FROM platform_infra.jobs`);
  return {
    tasks: tasks[0]!.count, jobs: jobs[0]!.count,
    resources: (await f!.resources.api.list({ projectId: f!.projectId, includeStopped: true })).map(v => v.id).sort(),
    used: await f!.resources.api.occupancy(f!.projectId),
    objects: structuredClone([...f!.k8s.objects].sort(([a], [b]) => a.localeCompare(b))),
  };
}
/** Select the original accepted job in this isolated test DB; execute the real native worker. */
async function runOnly(taskId: TaskId) {
  await f!.tdb.db.execute(sql`UPDATE platform_infra.jobs SET run_at = CASE WHEN payload->>'taskId' = ${taskId} THEN clock_timestamp() - interval '1 second' ELSE clock_timestamp() + interval '1 hour' END WHERE kind = ${NATIVE_EXECUTION_JOB_KIND}`);
  return (f!.runtime.workers[1] as Worker).runOnce();
}
async function pendingCleanup(taskId: TaskId) {
  expect(await f!.resources.api.get(taskId)).toMatchObject({ desired: 'absent', phase: 'stopping', conditions: expect.arrayContaining([
    expect.objectContaining({ type: 'ReleasePending', status: 'true', reason: 'execution-cleanup-pending' }),
  ]) });
}
async function seal() {
  const protectedChild = await f!.runtime.api.createNativeExecution(f!.request());
  await f!.runtime.api.releaseEnvironment(f!.parent.id, 'user');
  const parent = await f!.load(f!.parent.id);
  expect(parent).toMatchObject({ state: 'running', connected: true, parentEnding: { phase: 'admission-sealed' } });
  return protectedChild;
}

describe.skipIf(!available)('legacy CLI and Agent parent admission seal (real PG)', () => {
  for (const mode of ['native', 'ledger'] as const) for (const purpose of ['cli', 'agent'] as const) {
    test(`${mode} ${purpose}: actual parent ending admits no new task, resource, job, quota or physical preparation`, async () => {
      await setup(mode); const original = await seal(), before = await snapshot(); f!.calls.length = 0;
      await expect(f!.runtime.api.createNativeExecution(legacy(purpose))).rejects.toMatchObject({ kind: 'precondition' });
      expect(await snapshot()).toEqual(before);
      expect(f!.calls.some(call => call.startsWith('create:') || call === 'materials')).toBe(false);
      expect((await f!.load(original.id)).native?.state).toBe('queued');
      expect((await f!.load(f!.parent.id)).runnerTokenHash).toBe(f!.parent.runnerTokenHash);
    }, 15000);
  }

  test('an already queued legacy child enters original cleaning without preparing fresh UID, token or materials after seal', async () => {
    await setup(); const child = await admitLegacy('cli'); await seal();
    const before = await snapshot(); f!.calls.length = 0;
    expect(await f!.runNative()).toBe(1);
    const current = await f!.load(child.id);
    expect(current).toMatchObject({ state: 'releasing', native: { state: 'cleaning', parentTaskId: child.native!.parentTaskId } });
    expect(current.native?.podUid).toBeUndefined(); expect(current.native?.secretUid).toBeUndefined(); expect(current.native?.preparedAt).toBeUndefined();
    // Original cleanup invalidates the old credential; no prepared credential/UID is published.
    expect(current.runnerTokenHash).not.toBe(child.runnerTokenHash);
    expect(f!.calls.some(call => call.startsWith('create:') || call === 'materials')).toBe(false);
    const after = await snapshot();
    expect(after.tasks).toBe(before.tasks); expect(after.resources).toEqual(before.resources);
    expect(after.objects).toEqual(before.objects); expect(after.used).toBe(before.used);
    await pendingCleanup(child.id);
    expect((await f!.load(f!.parent.id)).parentEnding).toMatchObject({ phase: 'admission-sealed' });
  }, 15000);

  test('an unobserved queued legacy child keeps quota across a cleanup read failure and retires only after original retry', async () => {
    await setup(); const child = await admitLegacy('cli'); await seal();
    const used = await f!.resources.api.occupancy(f!.projectId);
    expect(await runOnly(child.id)).toBe(1); await pendingCleanup(child.id);
    const get = f!.k8s.get.bind(f!.k8s);
    f!.k8s.get = async <T extends K8sObject>(...args: Parameters<typeof get>) => {
      if (args[0] === Resources.Pod && args[1] === child.podName) throw new Error('cleanup read temporarily unavailable');
      return get<T>(...args);
    };
    try {
      expect(await runOnly(child.id)).toBe(1); await pendingCleanup(child.id);
      expect((await f!.load(child.id)).native?.state).toBe('cleaning');
      expect(await f!.resources.api.occupancy(f!.projectId)).toBe(used);
    } finally { f!.k8s.get = get; }
    expect(await runOnly(child.id)).toBe(1);
    expect((await f!.load(child.id)).native?.state).toBe('finished');
    expect(await f!.k8s.get(Resources.Pod!, child.podName, child.namespace)).toBeUndefined();
    expect(await f!.k8s.get(Resources.Secret!, child.podName + '-runner', child.namespace)).toBeUndefined();
    expect(await f!.resources.api.get(child.id)).toMatchObject({ phase: 'stopped', conditions: expect.arrayContaining([
      expect.objectContaining({ type: 'ReleasePending', status: 'false' }),
    ]) });
    expect(await f!.resources.api.occupancy(f!.projectId)).toBe(used - 1);
    expect((await f!.load(f!.parent.id)).parentEnding).toMatchObject({ phase: 'admission-sealed' });
  }, 15000);

  test('a bound legacy Agent retains quota through failed cleanup and actual stop until original Missing observations', async () => {
    await setup(); const child = await admitLegacy('agent');
    expect(await runOnly(child.id)).toBe(1);
    const pod = (await f!.k8s.get(Resources.Pod!, child.podName, child.namespace))!;
    const secret = (await f!.k8s.get(Resources.Secret!, child.podName + '-runner', child.namespace))!;
    const token = (secret.stringData as Record<string, string>).CS_RUNNER_TOKEN!;
    await f!.k8s.mergePatch(Resources.Pod!, child.podName, child.namespace, { status: { phase: 'Running' } });
    expect(await f!.runtime.api.onRunnerConnected(child.id, token)).toBe(true);
    expect((await f!.load(child.id)).native?.state).toBe('running');
    const podChild = { kind: 'Pod', namespace: child.namespace, name: child.podName, uid: pod.metadata.uid!, phase: 'Running', ready: true };
    const secretChild = { kind: 'Secret', namespace: child.namespace, name: child.podName + '-runner', uid: secret.metadata.uid!, phase: 'Present', ready: true };
    await f!.resources.api.observe({ resourceId: child.id, child: podChild });
    await f!.resources.api.observe({ resourceId: child.id, child: secretChild });
    await seal(); const used = await f!.resources.api.occupancy(f!.projectId);
    await f!.runtime.api.releaseEnvironment(child.id, 'user'); await pendingCleanup(child.id);
    expect(await f!.resources.api.occupancy(f!.projectId)).toBe(used);
    const get = f!.k8s.get.bind(f!.k8s);
    f!.k8s.get = async <T extends K8sObject>(...args: Parameters<typeof get>) => {
      if (args[0] === Resources.Pod && args[1] === child.podName) throw new Error('physical cleanup read temporarily unavailable');
      return get<T>(...args);
    };
    try {
      expect(await runOnly(child.id)).toBe(1); await pendingCleanup(child.id);
      expect((await f!.load(child.id)).native?.state).toBe('cleaning');
      expect(await f!.resources.api.occupancy(f!.projectId)).toBe(used);
    } finally { f!.k8s.get = get; }
    expect(await runOnly(child.id)).toBe(1);
    expect((await f!.load(child.id)).native?.state).toBe('finished');
    // A finished Task does not erase a still-present ledger observation or release its quota.
    expect(await f!.resources.api.get(child.id)).toMatchObject({ phase: 'stopping' });
    expect(await f!.resources.api.occupancy(f!.projectId)).toBe(used);
    expect(await f!.k8s.get(Resources.Pod!, child.podName, child.namespace)).toBeUndefined();
    expect(await f!.k8s.get(Resources.Secret!, child.podName + '-runner', child.namespace)).toBeUndefined();
    await f!.resources.api.observe({ resourceId: child.id, child: podChild, gone: true });
    expect(await f!.resources.api.occupancy(f!.projectId)).toBe(used);
    await f!.resources.api.observe({ resourceId: child.id, child: secretChild, gone: true });
    expect(await f!.resources.api.get(child.id)).toMatchObject({ phase: 'stopped' });
    expect(await f!.resources.api.occupancy(f!.projectId)).toBe(used - 1);
    expect((await f!.load(f!.parent.id)).runnerTokenHash).toBe(f!.parent.runnerTokenHash);
    expect((await f!.load(f!.parent.id)).parentEnding).toMatchObject({ phase: 'admission-sealed' });
  }, 15000);

  test('an unchanged historical replay stays read-only after seal while a changed replay remains conflict', async () => {
    await setup(); const request = legacy('cli'), child = await f!.runtime.api.createNativeExecution(request); await seal();
    const before = await snapshot();
    expect(await f!.runtime.api.createNativeExecution(request)).toEqual(child);
    await expect(f!.runtime.api.createNativeExecution({ ...request, fingerprint: 'b'.repeat(64) })).rejects.toMatchObject({ kind: 'conflict' });
    expect(await snapshot()).toEqual(before);
  }, 15000);

  test('explicit malformed and complete markers never authorize new legacy admission', async () => {
    await setup();
    // Markers are intentionally invalid input, not manufactured physical completion evidence.
    for (const marker of [false, { version: 1 }, { version: 1, endingId: newResourceId(), epochHash: 'a'.repeat(64), phase: 'complete' }]) {
      await f!.tdb.db.execute(sql`UPDATE task_runtime.environments SET parent_ending=${JSON.stringify(marker)}::jsonb WHERE id=${f!.parent.id}`);
      const before = await snapshot(); f!.calls.length = 0;
      await expect(f!.runtime.api.createNativeExecution(legacy('cli'))).rejects.toMatchObject({ kind: 'precondition' });
      expect(await snapshot()).toEqual(before);
      expect(f!.calls.some(call => call.startsWith('create:') || call === 'materials')).toBe(false);
    }
  }, 15000);

  for (const purpose of ['cli', 'agent'] as const) test(`unsealed ${purpose} still prepares its original native execution`, async () => {
    await setup(); const child = await admitLegacy(purpose);
    expect(await f!.runNative()).toBe(1);
    const current = await f!.load(child.id);
    expect(current.native).toMatchObject({ state: 'starting', parentPodUid: f!.parent.podUid, pvcUid: f!.pvc.metadata.uid });
    expect(current.native?.podUid).toBeDefined(); expect(current.native?.secretUid).toBeDefined();
    expect(current.runnerTokenHash).not.toBe(child.runnerTokenHash);
    expect((await f!.load(f!.parent.id)).runnerTokenHash).toBe(f!.parent.runnerTokenHash);
    expect(f!.calls.some(call => call.startsWith('create:'))).toBe(true);
  }, 15000);
});
