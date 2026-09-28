import { expect, test } from 'bun:test';
import { createFakeK8sClient, Resources } from '@crewstation/k8s';
import { OBJECT_TRANSFER_FINALIZER, objectTransferOwners } from './objectTransferOwners';

async function fixture() {
  const k8s = createFakeK8sClient(), uid = Bun.randomUUIDv7(), nodeUid = Bun.randomUUIDv7();
  await k8s.apply({ apiVersion: 'v1', kind: 'Node', metadata: { name: 'node', uid: nodeUid }, status: { conditions: [{ type: 'Ready', status: 'True' }], nodeInfo: { kubeletVersion: 'v1.34.0' } } });
  await k8s.apply({ apiVersion: 'coordination.k8s.io/v1', kind: 'Lease', metadata: { name: 'node', namespace: 'kube-node-lease', ownerReferences: [{ apiVersion: 'v1', kind: 'Node', name: 'node', uid: nodeUid }] }, spec: { holderIdentity: 'node', renewTime: new Date().toISOString() } });
  await k8s.apply({ apiVersion: 'v1', kind: 'Pod', metadata: { name: 'api', uid, namespace: 'system', resourceVersion: '1', deletionTimestamp: new Date().toISOString(), finalizers: [OBJECT_TRANSFER_FINALIZER, 'another/guard'], labels: { 'app.kubernetes.io/name': 'cs-api', 'app.kubernetes.io/part-of': 'crewstation' } }, spec: { nodeName: 'node', containers: [{ name: 'api' }] }, status: { phase: 'Succeeded', containerStatuses: [{ name: 'api', state: { terminated: { containerID: 'containerd://api', exitCode: 0, finishedAt: new Date().toISOString() } } }] } });
  return { k8s, uid, owners: objectTransferOwners(k8s, 'system') };
}
test('the actual terminal Pod is retained until durable read recovery succeeds; foreign finalizers survive', async () => {
  const f = await fixture(); let accepted = '';
  await expect(f.owners.sweep(async () => { throw new Error('PG down'); })).rejects.toThrow('PG down');
  expect((await f.k8s.get(Resources.Pod!, 'api', 'system'))?.metadata.finalizers).toContain(OBJECT_TRANSFER_FINALIZER);
  await f.owners.sweep(async (uid, digest) => { accepted = uid; expect(digest).toMatch(/^[a-f0-9]{64}$/); });
  expect(accepted).toBe(f.uid);
  expect((await f.k8s.get(Resources.Pod!, 'api', 'system'))?.metadata.finalizers).toEqual(['another/guard']);
});
test('a running sidecar, unknown node, stale lease or absent Pod never supplies a stop proof', async () => {
  for (const mode of ['sidecar', 'node', 'lease', 'absent']) {
    const f = await fixture(); let accepted = false;
    if (mode === 'sidecar') await f.k8s.mergePatch(Resources.Pod!, 'api', 'system', { status: { containerStatuses: [{ name: 'api', state: { terminated: { containerID: 'containerd://api', exitCode: 0, finishedAt: new Date().toISOString() } } }, { name: 'extra', state: { running: {} } }] } });
    if (mode === 'node') await f.k8s.delete(Resources.Node!, 'node');
    if (mode === 'lease') await f.k8s.mergePatch(Resources.Lease!, 'node', 'kube-node-lease', { spec: { renewTime: '2000-01-01T00:00:00Z' } });
    if (mode === 'absent') await f.k8s.delete(Resources.Pod!, 'api', 'system');
    await f.owners.sweep(async () => { accepted = true; }); expect(accepted).toBe(false);
  }
});
test('a replaced Pod cannot have its finalizer removed using the previous UID proof', async () => {
  const f = await fixture();
  await expect(f.owners.sweep(async () => { await f.k8s.mergePatch(Resources.Pod!, 'api', 'system', { metadata: { uid: Bun.randomUUIDv7() } }); })).rejects.toThrow();
  expect((await f.k8s.get(Resources.Pod!, 'api', 'system'))?.metadata.finalizers).toContain(OBJECT_TRANSFER_FINALIZER);
});
test('never-scheduled and confirmed never-started containers do not strand an API Pod finalizer', async () => {
  for (const mode of ['unscheduled', 'image-pull', 'init-failed']) {
    const f = await fixture(); let accepted = false;
    await f.k8s.mergePatch(Resources.Pod!, 'api', 'system', {
      spec: { ...(mode === 'unscheduled' ? { nodeName: null } : {}), ...(mode === 'init-failed' ? { initContainers: [{ name: 'init' }] } : {}) },
      status: { phase: mode === 'unscheduled' ? 'Pending' : 'Failed', conditions: [{ type: 'PodReadyToStartContainers', status: 'False' }],
        containerStatuses: [{ name: 'api', restartCount: 0, state: { waiting: { reason: 'ImagePullBackOff' } } }],
        ...(mode === 'init-failed' ? { initContainerStatuses: [{ name: 'init', state: { terminated: { containerID: 'containerd://init', exitCode: 1, finishedAt: new Date().toISOString() } } }] } : {}) },
    });
    await f.owners.sweep(async () => { accepted = true; }); expect(accepted).toBe(true);
  }
});
test('unknown container state, old kubelet, restart history and ephemeral containers retain the guard', async () => {
  for (const mode of ['unknown', 'kubelet', 'history', 'ephemeral']) {
    const f = await fixture(); let accepted = false;
    if (mode === 'unknown') await f.k8s.mergePatch(Resources.Pod!, 'api', 'system', { status: { containerStatuses: [{ name: 'api', state: { terminated: { containerID: 'containerd://api', exitCode: 137, finishedAt: new Date().toISOString(), reason: 'ContainerStatusUnknown' } } }] } });
    if (mode === 'kubelet') await f.k8s.mergePatch(Resources.Node!, 'node', undefined, { status: { nodeInfo: { kubeletVersion: 'v1.26.0' } } });
    if (mode === 'history') await f.k8s.mergePatch(Resources.Pod!, 'api', 'system', { status: { conditions: [{ type: 'PodReadyToStartContainers', status: 'False' }], containerStatuses: [{ name: 'api', restartCount: 1, state: { waiting: {} } }] } });
    if (mode === 'ephemeral') await f.k8s.mergePatch(Resources.Pod!, 'api', 'system', { spec: { ephemeralContainers: [{ name: 'debug' }] }, status: { ephemeralContainerStatuses: [{ name: 'debug', state: { running: {} } }] } });
    await f.owners.sweep(async () => { accepted = true; }); expect(accepted).toBe(false);
  }
});
