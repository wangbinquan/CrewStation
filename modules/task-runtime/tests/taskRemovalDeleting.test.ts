// Existing owner factories and real PG quota; deleting is intent, never physical Stop proof.
import { afterEach, describe, expect, test } from 'bun:test';
import { DEVELOPMENT_REMOVAL_ANNOTATION } from '@crewstation/contracts';
import { Resources } from '@crewstation/k8s';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { removeTaskPod } from '../adapters/k8s/taskRemoval';
import type { TaskDevelopmentRemovalQuery } from '../adapters/k8s/taskRemovalGuard';
import { rebuildFixture } from './rebuildFixture';

const available = await testDatabaseAvailable();
let f: Awaited<ReturnType<typeof rebuildFixture>> | undefined;
afterEach(async () => { await f?.close(); f = undefined; });
async function deleting(rebuilt = false) {
  f = await rebuildFixture({ running: !rebuilt });
  if (rebuilt) { await f.runtime.api.requestRebuild(f.projectId, await f.request()); await f.run(); }
  const env = (await f.uow.read.environments.getById(f.env.id))!;
  await f.k8s.mergePatch(Resources.Pod!, env.podName, env.namespace, { metadata: { deletionTimestamp: '2026-10-02T00:00:00Z', finalizers: ['fixture/hold'] } });
  return env;
}
describe.skipIf(!available)('conditional removal of deleting original Pods', () => {
  for (const rebuilt of [false, true]) test((rebuilt ? 'rebuilt' : 'ordinary') + ': a deleting Pod still receives UID/RV DELETE and retained finalizers do not release quota', async () => {
    const env = await deleting(rebuilt), k8s = f!.k8s;
    const pod = (await k8s.get(Resources.Pod!, env.podName, env.namespace))!, before = structuredClone(pod);
    const remove = k8s.delete, calls: Parameters<typeof remove>[] = [];
    k8s.delete = async (...args) => { calls.push(args); return true; };
    await removeTaskPod(k8s, env, async () => ({ kind: 'unselected' }));
    const request = calls.find(([ref]) => ref.kind === 'Pod')!;
    expect(request.slice(1, 3)).toEqual([env.podName, env.namespace]);
    expect(request[3]).toEqual({ gracePeriodSeconds: 30, preconditions: { uid: pod.metadata.uid!, resourceVersion: pod.metadata.resourceVersion! } });
    expect(await k8s.get(Resources.Pod!, env.podName, env.namespace)).toEqual(before);
    expect(await f!.runtime.api.runningTaskCount(f!.projectId)).toBe(1);
    k8s.delete = remove;
  });
  for (const kind of ['waiting', 'marked-unselected'] as const) test(kind + ': deleting still does not bypass its owner query', async () => {
    const env = await deleting(), k8s = f!.k8s;
    if (kind === 'marked-unselected') await k8s.mergePatch(Resources.Pod!, env.podName, env.namespace, { metadata: { annotations: { [DEVELOPMENT_REMOVAL_ANNOTATION]: '1' } } });
    const before = structuredClone([...k8s.objects]);
    const query: TaskDevelopmentRemovalQuery = async () => kind === 'waiting' ? { kind: 'waiting', reason: 'original-source-pending' } : { kind: 'unselected' };
    await expect(removeTaskPod(k8s, env, query)).rejects.toMatchObject({ kind: 'precondition' });
    expect(k8s.deleted).toEqual([]); expect([...k8s.objects]).toEqual(before);
    expect(await f!.runtime.api.runningTaskCount(f!.projectId)).toBe(1);
  });
  for (const field of ['uid', 'resourceVersion'] as const) test(field + ': an object replacement/version race after the query is stopped by actual DELETE CAS', async () => {
    const env = await deleting(), k8s = f!.k8s;
    const original = (await k8s.get(Resources.Pod!, env.podName, env.namespace))!;
    await expect(removeTaskPod(k8s, env, async () => {
      await k8s.mergePatch(Resources.Pod!, env.podName, env.namespace, { metadata: field === 'uid' ? { uid: 'replacement-instance' } : { annotations: { changed: '1' } } });
      return { kind: 'permitted', resourceVersion: original.metadata.resourceVersion! };
    })).rejects.toMatchObject({ kind: 'conflict' });
    expect(k8s.deleted).toEqual([]);
    const current = (await k8s.get(Resources.Pod!, env.podName, env.namespace))!;
    expect(current.metadata.resourceVersion).not.toBe(original.metadata.resourceVersion);
    if (field === 'uid') expect(current.metadata.uid).toBe('replacement-instance');
    expect(await f!.runtime.api.runningTaskCount(f!.projectId)).toBe(1);
  });
  test('lost DELETE ACK is an error; a subsequent fresh read of absence does not fabricate physical proof or quota release', async () => {
    const env = await deleting(), k8s = f!.k8s, remove = k8s.delete;
    k8s.delete = async (...args) => { await remove(...args); throw new Error('original DELETE ACK lost'); };
    await expect(removeTaskPod(k8s, env)).rejects.toThrow('original DELETE ACK lost');
    expect(await k8s.get(Resources.Pod!, env.podName, env.namespace)).toBeUndefined();
    k8s.delete = remove; await removeTaskPod(k8s, env);
    expect(await f!.runtime.api.runningTaskCount(f!.projectId)).toBe(1);
    expect((await f!.uow.read.environments.getById(env.id))?.state).toBe(env.state);
  });
});
