import { expect, test } from 'bun:test';
import type { WorkloadConsumer } from '@crewstation/contracts';
import { TaskIdSchema, WORKLOAD_CONSUMER_ANNOTATION, WORKLOAD_STOP_FINALIZER } from '@crewstation/contracts';
import { createFakeK8sClient, Resources } from '@crewstation/k8s';
import { newResourceId } from '@crewstation/kernel';
import { observeWorkloadStop, releaseWorkloadStop } from './workloadStop';

async function fixture() {
  const k8s = createFakeK8sClient(), now = new Date(), nodeUid = crypto.randomUUID();
  const consumer: WorkloadConsumer = { id: newResourceId(), resourceId: newResourceId(), taskId: TaskIdSchema.parse(newResourceId()), revision: 1, namespace: 'cs-test', podName: 'task-one', volumeUid: crypto.randomUUID(), purpose: 'business', finalization: null };
  await k8s.create({ apiVersion: 'v1', kind: 'Node', metadata: { name: 'node-one', uid: nodeUid }, status: { conditions: [{ type: 'Ready', status: 'True' }], nodeInfo: { kubeletVersion: 'v1.34.1' } } });
  const lease = await k8s.create({ apiVersion: 'coordination.k8s.io/v1', kind: 'Lease', metadata: { name: 'node-one', namespace: 'kube-node-lease', ownerReferences: [{ apiVersion: 'v1', kind: 'Node', name: 'node-one', uid: nodeUid }] }, spec: { holderIdentity: 'node-one', renewTime: now.toISOString() } });
  const pod = await k8s.create({ apiVersion: 'v1', kind: 'Pod', metadata: { name: consumer.podName, namespace: consumer.namespace, uid: crypto.randomUUID(), deletionTimestamp: now.toISOString(),
    finalizers: [WORKLOAD_STOP_FINALIZER, 'example.com/retain'], annotations: { [WORKLOAD_CONSUMER_ANNOTATION]: consumer.id } },
    spec: { nodeName: 'node-one', containers: [{ name: 'runner' }] }, status: { phase: 'Succeeded', containerStatuses: [{ name: 'runner', state: { terminated: { exitCode: 0, containerID: 'containerd://one', finishedAt: now.toISOString() } } }] } });
  return { k8s, now, consumer, pod, lease };
}
test('live node lease and ownership evidence is required; stale heartbeat and mismatched node UID remain blocked', async () => {
  const { k8s, now, consumer, lease } = await fixture();
  expect(await observeWorkloadStop(k8s, consumer, now)).toMatchObject({ state: 'proved' });
  await k8s.apply({ ...lease, spec: { holderIdentity: 'node-one', renewTime: new Date(now.getTime() - 60000).toISOString() } });
  expect(await observeWorkloadStop(k8s, consumer, now)).toMatchObject({ state: 'blocked', code: 'node_stop_observation_unknown' });
  await k8s.apply({ ...lease, metadata: { ...lease.metadata, ownerReferences: [{ apiVersion: 'v1', kind: 'Node', name: 'node-one', uid: crypto.randomUUID() }] } });
  expect(await observeWorkloadStop(k8s, consumer, now)).toMatchObject({ state: 'blocked' });
});
test('finalizer release preserves other owners and uses current UID/resourceVersion CAS; replacement is never modified', async () => {
  const { k8s, now, consumer, pod } = await fixture();
  const observed = await observeWorkloadStop(k8s, consumer, now); if (observed.state !== 'proved') throw new Error(observed.code);
  await releaseWorkloadStop(k8s, observed.proof);
  expect((await k8s.get(Resources.Pod!, consumer.podName, consumer.namespace))?.metadata.finalizers).toEqual(['example.com/retain']);
  await releaseWorkloadStop(k8s, observed.proof);
  expect(k8s.deleted).toEqual([]);
  await k8s.apply({ ...pod, metadata: { ...pod.metadata, uid: crypto.randomUUID() } });
  await expect(releaseWorkloadStop(k8s, observed.proof)).rejects.toMatchObject({ kind: 'conflict' });
  expect((await k8s.get(Resources.Pod!, consumer.podName, consumer.namespace))?.metadata.finalizers).toContain(WORKLOAD_STOP_FINALIZER);
});
test('an API change between live read and finalizer patch fails closed', async () => {
  const { k8s, now, consumer } = await fixture();
  const observed = await observeWorkloadStop(k8s, consumer, now); if (observed.state !== 'proved') throw new Error(observed.code);
  const patch = k8s.jsonPatch;
  k8s.jsonPatch = async (...args) => {
    const current = (await k8s.get(Resources.Pod!, consumer.podName, consumer.namespace))!;
    await k8s.apply({ ...current, metadata: { ...current.metadata, annotations: { ...current.metadata.annotations, concurrent: 'change' } } });
    return patch(...args);
  };
  await expect(releaseWorkloadStop(k8s, observed.proof)).rejects.toMatchObject({ kind: 'conflict' });
  expect((await k8s.get(Resources.Pod!, consumer.podName, consumer.namespace))?.metadata.finalizers).toContain(WORKLOAD_STOP_FINALIZER);
});
