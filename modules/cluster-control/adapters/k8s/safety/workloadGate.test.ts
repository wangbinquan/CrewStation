import { expect, test } from 'bun:test';
import { TaskIdSchema, WORKLOAD_STOP_FINALIZER } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { createFakeK8sClient, LABELS, Resources } from '@crewstation/k8s';
import type { WorkloadPodRender } from '../../../domain/workloadRender';
import { workloadPodObject } from '../workloadObjects';
import { assertPinnedVolume } from '../pinnedVolume';
import { activateWorkload, assertWorkloadGate, inspectWorkloadStart } from './workloadGate';

async function fixture() {
  const id = TaskIdSchema.parse(newResourceId()), k8s = createFakeK8sClient(), nodeUid = crypto.randomUUID();
  const pod: WorkloadPodRender = { name: `task-${id}`, namespace: 'cs-gate', taskId: id, image: 'runtime@sha256:fixture', workerUid: 10001,
    resources: { cpu: '1', memory: '1Gi', storage: '1Gi' }, workload: 'business-task', project: 'demo', service: 'demo', pvc: 'work', secret: 'runner',
    businessStorage: { version: 1, ownerTaskId: id, initialize: true }, consumerVolumeUid: crypto.randomUUID(),
    consumer: { id: newResourceId(), taskId: id, revision: 1, purpose: 'business', finalization: null } };
  const object = workloadPodObject(pod); object.metadata.uid = crypto.randomUUID();
  await k8s.create(object);
  await k8s.create({ apiVersion: 'v1', kind: 'PersistentVolumeClaim', metadata: { name: 'work', namespace: pod.namespace, uid: pod.consumerVolumeUid, labels: { [LABELS.task]: id } }, status: { phase: 'Bound' } });
  await k8s.create({ apiVersion: 'v1', kind: 'Node', metadata: { name: 'node-1', uid: nodeUid }, status: { conditions: [{ type: 'Ready', status: 'True' }], nodeInfo: { kubeletVersion: 'v1.35.0' } } });
  await k8s.create({ apiVersion: 'coordination.k8s.io/v1', kind: 'Lease', metadata: { name: 'node-1', namespace: 'kube-node-lease', ownerReferences: [{ apiVersion: 'v1', kind: 'Node', name: 'node-1', uid: nodeUid }] }, spec: { holderIdentity: 'node-1', renewTime: new Date().toISOString() } });
  return { pod, object, k8s, nodeUid };
}
test('admission init precedes all writes, has no work mount or API token, and accepts API-server defaults', async () => {
  const { pod, object } = await fixture(), spec = object.spec as { initContainers: Array<Record<string, unknown>>; volumes: Array<Record<string, unknown>> };
  expect(object.metadata.finalizers).toContain(WORKLOAD_STOP_FINALIZER);
  expect(spec.initContainers[0]?.['name']).toBe('workload-admission');
  expect((spec.initContainers[0]?.['command'] as string[])[2]).toContain('/opt/crewstation/bin/task-runner storage-contract 1');
  expect(spec.initContainers).toHaveLength(2);
  expect(spec.initContainers[0]?.['volumeMounts']).toEqual([{ name: 'workload-admission', mountPath: '/run/admission', readOnly: true }]);
  expect(object.spec).toMatchObject({ automountServiceAccountToken: false });
  const env = spec.initContainers[0]!['env'] as Array<{ valueFrom: { fieldRef: { apiVersion?: string } } }>;
  env[0]!.valueFrom.fieldRef.apiVersion = 'v1';
  const secret = spec.volumes.find((v) => v['name'] === 'workload-admission')!['secret'] as Record<string, unknown>; secret['defaultMode'] = 420;
  expect(() => assertWorkloadGate(object, pod)).not.toThrow();
  for (const change of [
    (clone: typeof object) => { clone.metadata.finalizers = []; },
    (clone: typeof object) => { (clone.spec as typeof spec).initContainers.reverse(); },
    (clone: typeof object) => { (clone.spec as typeof spec).initContainers[0]!['volumeMounts'] = [{ name: 'work', mountPath: '/work' }]; },
  ]) { const clone = structuredClone(object); change(clone); expect(() => assertWorkloadGate(clone, pod)).toThrow(); }
});
test('start grants require a fresh ready node and the original bound volume; immutable permits reject a replacement UID', async () => {
  const f = await fixture(); expect(await inspectWorkloadStart(f.k8s, f.pod)).toBeUndefined();
  await f.k8s.apply({ ...f.object, spec: { ...(f.object.spec as object), nodeName: 'node-1' }, status: { phase: 'Pending' } });
  const permit = (await inspectWorkloadStart(f.k8s, f.pod))!;
  expect(permit).toEqual({ podUid: f.object.metadata.uid!, nodeName: 'node-1', nodeUid: f.nodeUid });
  await activateWorkload(f.k8s, f.pod, permit); await activateWorkload(f.k8s, f.pod, permit);
  expect((await f.k8s.get(Resources.Secret!, `${f.pod.name}-admission`, f.pod.namespace))?.['stringData']).toMatchObject({ podUid: permit.podUid });
  await expect(activateWorkload(f.k8s, f.pod, { ...permit, podUid: crypto.randomUUID() })).rejects.toThrow();
  const lease = (await f.k8s.get(Resources.Lease!, 'node-1', 'kube-node-lease'))!;
  await f.k8s.apply({ ...lease, spec: { holderIdentity: 'node-1', renewTime: '2020-01-01T00:00:00Z' } });
  expect(await inspectWorkloadStart(f.k8s, f.pod)).toBeUndefined();
  const volume = (await f.k8s.get(Resources.PersistentVolumeClaim!, 'work', f.pod.namespace))!;
  await f.k8s.apply({ ...volume, metadata: { ...volume.metadata, uid: crypto.randomUUID() } });
  await expect(inspectWorkloadStart(f.k8s, f.pod)).rejects.toThrow();
  await expect(assertPinnedVolume(f.k8s, f.pod)).rejects.toThrow();
});
test('WaitForFirstConsumer can schedule the original pending PVC, but it cannot unlock work before Bound', async () => {
  const f = await fixture(), volume = (await f.k8s.get(Resources.PersistentVolumeClaim!, 'work', f.pod.namespace))!;
  await f.k8s.apply({ ...volume, status: { phase: 'Pending' } });
  await assertPinnedVolume(f.k8s, f.pod);
  await expect(assertPinnedVolume(f.k8s, { ...f.pod, businessStorage: { ...f.pod.businessStorage!, initialize: false } })).rejects.toThrow();
  await f.k8s.apply({ ...f.object, spec: { ...(f.object.spec as object), nodeName: 'node-1' }, status: { phase: 'Pending' } });
  expect(await inspectWorkloadStart(f.k8s, f.pod)).toBeUndefined();
  expect(await f.k8s.get(Resources.Secret!, `${f.pod.name}-admission`, f.pod.namespace)).toBeUndefined();
});

test('fresh original development parent evidence is required again before every start grant', async () => {
  const f = await fixture(), parentId = TaskIdSchema.parse(newResourceId()), parentUid = crypto.randomUUID();
  const pod: WorkloadPodRender = { ...f.pod, businessStorage: undefined, workload: 'dev-session', developmentUsageStorage: { version: 1 }, developmentUsageProtection: { version: 1 },
    consumer: { id: f.pod.consumer!.id, taskId: parentId, revision: 1, purpose: 'agent', finalization: null }, expectedVolumeUid: f.pod.consumerVolumeUid,
    nodeName: 'node-1', workspace: { pod: 'original-parent', podUid: parentUid, pvcUid: f.pod.consumerVolumeUid! },
    labels: { 'crewstation.io/workspace-task': parentId }, annotations: { 'crewstation.io/cli-intent': 'a'.repeat(64) } };
  const desired = workloadPodObject(pod);
  await f.k8s.apply({ ...desired, metadata: { ...desired.metadata, uid: f.object.metadata.uid }, spec: { ...(desired.spec as object), nodeName: 'node-1' }, status: { phase: 'Pending' } });
  const volume = (await f.k8s.get(Resources.PersistentVolumeClaim!, 'work', pod.namespace))!;
  await f.k8s.apply({ ...volume, metadata: { ...volume.metadata, labels: { [LABELS.task]: parentId } } });
  const parent = { apiVersion: 'v1', kind: 'Pod', metadata: { name: 'original-parent', namespace: pod.namespace, uid: parentUid, labels: { [LABELS.task]: parentId } },
    spec: { nodeName: 'node-1', volumes: [{ name: 'work', persistentVolumeClaim: { claimName: 'work' } }] }, status: { phase: 'Running' } };
  await f.k8s.create(parent);
  expect((await inspectWorkloadStart(f.k8s, pod))?.podUid).toBe(f.object.metadata.uid);
  for (const altered of [
    { ...parent, metadata: { ...parent.metadata, uid: crypto.randomUUID() } },
    { ...parent, metadata: { ...parent.metadata, labels: { [LABELS.task]: newResourceId() } } },
    { ...parent, metadata: { ...parent.metadata, deletionTimestamp: new Date().toISOString() } },
    { ...parent, status: { phase: 'Failed' } },
    { ...parent, spec: { ...parent.spec, nodeName: 'replacement-node' } },
    { ...parent, spec: { ...parent.spec, volumes: [{ name: 'work', persistentVolumeClaim: { claimName: 'replacement-work' } }] } },
  ]) {
    await f.k8s.apply(altered);
    await expect(inspectWorkloadStart(f.k8s, pod)).rejects.toThrow();
  }
  await f.k8s.delete(Resources.Pod!, parent.metadata.name, pod.namespace);
  await expect(inspectWorkloadStart(f.k8s, pod)).rejects.toThrow();
});
