import { expect, test } from 'bun:test';
import { createFakeK8sClient, Resources } from '@crewstation/k8s';
import { inspectTaskClaim, inspectTaskVolume, removeTaskVolume, taskVolumeReclaimed } from '../adapters/k8s/safety/volumeReclaim';

const options = { systemNamespace: 'cs-system', probeToken: 't'.repeat(40), probeRoot: '/volumes', probePort: 8095 };
test('Pending PVC identity is observable before provisioning, without pretending a backend reclaim target exists', async () => {
  const k8s = createFakeK8sClient();
  expect(await inspectTaskClaim(k8s, 'cs-demo', 'work')).toBeUndefined();
  await k8s.apply({ apiVersion: 'v1', kind: 'PersistentVolumeClaim', metadata: { name: 'work', namespace: 'cs-demo', uid: 'pending-uid' }, spec: {}, status: { phase: 'Pending' } });
  expect(await inspectTaskClaim(k8s, 'cs-demo', 'work')).toEqual({ name: 'work', namespace: 'cs-demo', uid: 'pending-uid' });
  await expect(inspectTaskVolume(k8s, 'cs-demo', 'work', options, new Date())).rejects.toMatchObject({ details: { code: 'volume_reclaim_unavailable' } });
  await k8s.mergePatch(Resources.PersistentVolumeClaim!, 'work', 'cs-demo', { metadata: { deletionTimestamp: new Date().toISOString() } });
  await expect(inspectTaskClaim(k8s, 'cs-demo', 'work')).rejects.toThrow();
  expect(k8s.deleted).toHaveLength(0);
});
async function fixture(csi = false) {
  const k8s = createFakeK8sClient(), now = new Date();
  await k8s.apply({ apiVersion: 'v1', kind: 'PersistentVolumeClaim', metadata: { namespace: 'cs-demo', name: 'work', uid: 'pvc-original' }, spec: { volumeName: 'pv-original' } });
  await k8s.apply({ apiVersion: 'v1', kind: 'PersistentVolume', metadata: { name: 'pv-original', uid: 'pv-uid', finalizers: csi ? ['external-provisioner.volume.kubernetes.io/finalizer'] : ['kubernetes.io/pv-protection'], annotations: { 'pv.kubernetes.io/provisioned-by': 'rancher.io/local-path', 'local.path.provisioner/selected-node': 'node' } },
    spec: { claimRef: { uid: 'pvc-original', name: 'work', namespace: 'cs-demo' }, persistentVolumeReclaimPolicy: 'Delete', ...(csi ? { csi: { driver: 'test.csi', volumeHandle: 'backend-volume' } } : { hostPath: { path: '/volumes/pvc-original' } }) } });
  await k8s.apply({ apiVersion: 'v1', kind: 'Node', metadata: { name: 'node', uid: 'node-uid' }, status: { conditions: [{ type: 'Ready', status: 'True' }], nodeInfo: { kubeletVersion: 'v1.34.0' } } });
  await k8s.apply({ apiVersion: 'coordination.k8s.io/v1', kind: 'Lease', metadata: { name: 'node', namespace: 'kube-node-lease', ownerReferences: [{ apiVersion: 'v1', kind: 'Node', name: 'node', uid: 'node-uid' }] }, spec: { holderIdentity: 'node', renewTime: now.toISOString() } });
  await k8s.apply({ apiVersion: 'v1', kind: 'Pod', metadata: { namespace: 'cs-system', name: 'probe', uid: 'probe-uid', labels: { app: 'cs-storage-probe' } },
    spec: { nodeName: 'node', volumes: [{ name: 'root', hostPath: { path: '/volumes', type: 'Directory' } }], containers: [{ name: 'probe', volumeMounts: [{ name: 'root', mountPath: '/volumes', readOnly: true }] }] }, status: { podIP: '10.0.0.1', conditions: [{ type: 'Ready', status: 'True' }] } });
  const target = (await inspectTaskVolume(k8s, 'cs-demo', 'work', options, now))!;
  const gone = async () => { await removeTaskVolume(k8s, target, options, now); await k8s.delete(Resources.PersistentVolume!, 'pv-original'); };
  const response = (value: Record<string, unknown> = {}) => (async (_url: unknown, init?: RequestInit) => {
    expect((init?.headers as Record<string, string>)['authorization']).toBe(`Bearer ${options.probeToken}`);
    expect(JSON.parse(String(init?.body))).toEqual({ key: 'pvc-original/pv-uid', rootId: 'local', directory: 'pvc-original' });
    return Response.json({ key: 'pvc-original/pv-uid', absent: true, observedAt: new Date().toISOString(), ...value });
  }) as typeof fetch;
  return { k8s, now, target, gone, response };
}
test('local-path requires original node and authenticated absence after PVC and PV disappear', async () => {
  const f = await fixture(); expect(f.target).toMatchObject({ kind: 'local-path', nodeUid: 'node-uid', pvUid: 'pv-uid' });
  expect(await taskVolumeReclaimed(f.k8s, f.target, options, f.now, f.response())).toBe(false);
  await removeTaskVolume(f.k8s, f.target, options, f.now);
  expect(await taskVolumeReclaimed(f.k8s, f.target, options, f.now, f.response())).toBe(false);
  await f.k8s.delete(Resources.PersistentVolume!, 'pv-original');
  expect(await taskVolumeReclaimed(f.k8s, f.target, options, f.now, f.response({ absent: false }))).toBe(false);
  expect(await taskVolumeReclaimed(f.k8s, f.target, options, f.now, f.response())).toBe(true);
  await f.k8s.mergePatch(Resources.Node!, 'node', undefined, { metadata: { uid: 'replacement-node' } });
  await expect(taskVolumeReclaimed(f.k8s, f.target, options, f.now, f.response())).rejects.toThrow('原节点');
});
test('replacement PVC is never deleted; Retain and lost provider guarantees fail before deletion', async () => {
  const f = await fixture();
  await f.k8s.mergePatch(Resources.PersistentVolumeClaim!, 'work', 'cs-demo', { metadata: { uid: 'replacement' } });
  await expect(removeTaskVolume(f.k8s, f.target, options, f.now)).rejects.toMatchObject({ details: { code: 'workspace_volume_changed' } });
  expect(f.k8s.deleted).toHaveLength(0);
  await f.k8s.mergePatch(Resources.PersistentVolumeClaim!, 'work', 'cs-demo', { metadata: { uid: 'pvc-original' } });
  await f.k8s.mergePatch(Resources.PersistentVolume!, 'pv-original', undefined, { spec: { persistentVolumeReclaimPolicy: 'Retain' } });
  await expect(removeTaskVolume(f.k8s, f.target, options, f.now)).rejects.toThrow();
  expect(f.k8s.deleted).toHaveLength(0);
});
test('offline probes, wrong keyed replies and stale node observations cannot claim reclamation', async () => {
  const f = await fixture(); await f.gone();
  await expect(taskVolumeReclaimed(f.k8s, f.target, options, f.now, (async () => new Response(null, { status: 503 })) as unknown as typeof fetch)).rejects.toThrow();
  await expect(taskVolumeReclaimed(f.k8s, f.target, options, f.now, f.response({ key: 'wrong-pv' }))).rejects.toThrow('回执');
  await expect(taskVolumeReclaimed(f.k8s, f.target, options, f.now, f.response({ observedAt: '2000-01-01T00:00:00.000Z' }))).rejects.toThrow('时间');
  await expect(taskVolumeReclaimed(f.k8s, f.target, options, new Date(f.now.getTime() + 60_000), f.response())).rejects.toThrow('原节点');
});
test('CSI uses a pinned delete finalizer; PVC disappearance alone does not confirm backend release', async () => {
  const f = await fixture(true); expect(f.target.kind).toBe('csi');
  await removeTaskVolume(f.k8s, f.target, options, f.now);
  expect(await taskVolumeReclaimed(f.k8s, f.target, options, f.now)).toBe(false);
  await f.k8s.delete(Resources.PersistentVolume!, 'pv-original');
  expect(await taskVolumeReclaimed(f.k8s, f.target, options, f.now)).toBe(true);
  const missing = await fixture(true);
  await missing.k8s.mergePatch(Resources.PersistentVolume!, 'pv-original', undefined, { metadata: { finalizers: ['kubernetes.io/pv-protection'] } });
  await expect(removeTaskVolume(missing.k8s, missing.target, options, missing.now)).rejects.toThrow();
  expect(missing.k8s.deleted).toHaveLength(0);
});
