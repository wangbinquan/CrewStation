import { expect, test } from 'bun:test';
import { TaskIdSchema } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import type { WorkloadPodRender } from '../../domain/workloadRender';
import { createFakeK8sClient, Resources } from '@crewstation/k8s';
import type { K8sObject } from '@crewstation/k8s';
import { kubernetesClusterWriter } from './managedObjects';

const pod = { name: 'task-resume', namespace: 'cs-test', taskId: 'task-id', image: 'test:runtime', workerUid: 10001, resources: { cpu: '1', memory: '1Gi', storage: '1Gi' }, workload: 'business-task', project: 'test', service: 'test', pvc: 'task-work', secret: 'runner-2', expectedVolumeUid: 'original-volume' };
const volume: K8sObject = { apiVersion: 'v1', kind: 'PersistentVolumeClaim', metadata: { name: 'task-work', namespace: 'cs-test', uid: 'original-volume', labels: { 'crewstation.io/task': 'task-id' } }, status: { phase: 'Bound' } };
test('resume Pod writer checks live volume UID, ownership and readiness before any create or existing-Pod replay', async () => {
  const k8s = createFakeK8sClient(), writer = kubernetesClusterWriter(k8s);
  await expect(writer.ensurePod(pod)).rejects.toMatchObject({ details: { code: 'workspace_volume_changed' } });
  expect(k8s.objects.size).toBe(0);
  await k8s.create(volume);
  expect((await writer.ensurePod(pod)).created).toBe(true);
  expect((await writer.ensurePod(pod)).created).toBe(false);
  for (const replacement of [
    { ...volume, metadata: { ...volume.metadata, uid: 'replacement' } },
    { ...volume, metadata: { ...volume.metadata, labels: { 'crewstation.io/task': 'other' } } },
    { ...volume, metadata: { ...volume.metadata, deletionTimestamp: new Date().toISOString() } },
    { ...volume, status: { phase: 'Pending' } },
  ]) {
    await k8s.delete(Resources.PersistentVolumeClaim!, 'task-work', 'cs-test'); await k8s.create(replacement);
    await expect(writer.ensurePod(pod)).rejects.toMatchObject({ details: { code: 'workspace_volume_changed' } });
  }
  expect(k8s.objects.size).toBe(2);
});

test('protected development writers mount only their original parent-owned PVC, never a child-owned or replacement volume', async () => {
  const k8s = createFakeK8sClient(), writer = kubernetesClusterWriter(k8s), parent = TaskIdSchema.parse(newResourceId()), child = TaskIdSchema.parse(newResourceId()), uid = crypto.randomUUID();
  const selected: WorkloadPodRender = { ...pod, taskId: child, workload: 'dev-session', developmentUsageStorage: { version: 1 }, developmentUsageProtection: { version: 1 },
    expectedVolumeUid: uid, consumerVolumeUid: uid, consumer: { id: newResourceId(), taskId: parent, revision: 1, purpose: 'agent', finalization: null },
    nodeName: 'original-node', workspace: { pod: 'original-parent', podUid: crypto.randomUUID(), pvcUid: uid },
    labels: { 'crewstation.io/workspace-task': parent }, annotations: { 'crewstation.io/cli-intent': 'a'.repeat(64) } };
  const original = { ...volume, metadata: { ...volume.metadata, uid, labels: { 'crewstation.io/task': parent } } };
  await k8s.create(original);
  expect((await writer.ensurePod(selected)).created).toBe(true);
  expect((await writer.ensurePod(selected)).created).toBe(false);
  for (const changed of [
    { ...original, metadata: { ...original.metadata, labels: { 'crewstation.io/task': child } } },
    { ...original, metadata: { ...original.metadata, uid: crypto.randomUUID() } },
    { ...original, status: { phase: 'Pending' } },
    { ...original, metadata: { ...original.metadata, deletionTimestamp: new Date().toISOString() } },
  ]) {
    await k8s.apply(changed);
    await expect(writer.ensurePod(selected)).rejects.toMatchObject({ details: { code: 'workspace_volume_changed' } });
  }
  await k8s.apply({ ...original, metadata: { ...original.metadata, labels: {} } });
  await expect(writer.ensurePod({ ...selected, consumer: undefined })).rejects.toMatchObject({ details: { code: 'workspace_volume_changed' } });
  expect(k8s.applied.filter((o) => o.kind === 'Pod')).toHaveLength(0);
});
