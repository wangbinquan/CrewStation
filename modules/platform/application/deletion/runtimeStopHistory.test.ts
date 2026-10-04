import { expect, test } from 'bun:test';
import { TaskIdSchema, WorkloadConsumerSchema, WorkloadStopProofSchema } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { runtimeHistoricalStop } from './runtimeStopHistory';
import type { RuntimeStopHistory } from '../../ports/runtimeStops';

function fixture() {
  const taskId = TaskIdSchema.parse(newResourceId()), consumerId = newResourceId();
  const env = { id: taskId, kind: 'business', namespace: 'cs-history', podName: 'original-history', podUid: crypto.randomUUID(),
    businessWorkspace: { volumeUid: crypto.randomUUID() }, render: { workloadConsumerId: consumerId, start: 3 } };
  const consumer = WorkloadConsumerSchema.parse({ id: consumerId, resourceId: taskId, taskId, revision: 3, namespace: env.namespace,
    podName: env.podName, volumeUid: env.businessWorkspace.volumeUid, purpose: 'business', finalization: null });
  const permit = { podUid: env.podUid, nodeName: 'original-node', nodeUid: crypto.randomUUID(), grantedAt: new Date().toISOString() };
  const proof = WorkloadStopProofSchema.parse({ id: newResourceId(), consumer, podUid: permit.podUid, nodeName: permit.nodeName, nodeUid: permit.nodeUid, type: 'kubelet-terminated',
    podResourceVersion: 'original-42', observedAt: new Date().toISOString(),
    containers: [{ kind: 'container', name: 'runner', state: 'terminated', containerId: 'containerd://original', exitCode: 0 }] });
  let state: Awaited<ReturnType<RuntimeStopHistory['get']>> = { consumer, admissionClosed: true, startPermit: permit, stopProof: proof };
  const history: RuntimeStopHistory = { get: async () => state };
  return { env, consumer, permit, proof, history, set: (value: typeof state) => { state = value; } };
}
test('the original persisted stop proof survives Pod deletion and remains bound to its writer, volume and node', async () => {
  const f = fixture();
  expect((await runtimeHistoricalStop(f.history, f.env))?.digest).toMatch(/^[a-f0-9]{64}$/);
  f.set({ consumer: f.consumer, admissionClosed: true, startPermit: f.permit, stopProof: { ...f.proof, nodeUid: crypto.randomUUID() } });
  await expect(runtimeHistoricalStop(f.history, f.env)).rejects.toMatchObject({ kind: 'precondition' });
  f.set({ consumer: f.consumer, admissionClosed: true, startPermit: f.permit, stopProof: { ...f.proof, podUid: crypto.randomUUID() } });
  await expect(runtimeHistoricalStop(f.history, f.env)).rejects.toMatchObject({ kind: 'precondition' });
});
test('missing history, an open admission or an admitted writer without its proof remains pending', async () => {
  const f = fixture(); f.set(undefined);
  expect(await runtimeHistoricalStop(f.history, f.env)).toBeUndefined();
  f.set({ consumer: f.consumer, admissionClosed: false, startPermit: f.permit, stopProof: f.proof });
  expect(await runtimeHistoricalStop(f.history, f.env)).toBeUndefined();
  f.set({ consumer: f.consumer, admissionClosed: true, startPermit: f.permit, stopProof: null });
  expect(await runtimeHistoricalStop(f.history, f.env)).toBeUndefined();
});
test('a closed original with no permit proves never-admitted only when it has no original Pod identity', async () => {
  const f = fixture(); f.set({ consumer: f.consumer, admissionClosed: true, startPermit: null, stopProof: null });
  await expect(runtimeHistoricalStop(f.history, f.env)).rejects.toMatchObject({ kind: 'precondition' });
  expect((await runtimeHistoricalStop(f.history, { ...f.env, podUid: undefined }))?.digest).toMatch(/^[a-f0-9]{64}$/);
});
test('historical evidence cannot be borrowed from another task, resource, revision, Pod name or volume', async () => {
  const f = fixture();
  for (const change of [{ taskId: TaskIdSchema.parse(newResourceId()) }, { resourceId: newResourceId() }, { revision: 4 },
    { podName: 'replacement' }, { volumeUid: crypto.randomUUID() }, { purpose: 'agent' as const }]) {
    f.set({ consumer: { ...f.consumer, ...change }, admissionClosed: true, startPermit: f.permit, stopProof: f.proof });
    await expect(runtimeHistoricalStop(f.history, f.env)).rejects.toMatchObject({ kind: 'precondition' });
  }
});
