import { expect, test } from 'bun:test';
import { createFakeK8sClient, Resources } from '@crewstation/k8s';
import type { K8sObject } from '@crewstation/k8s';
import { TaskIdSchema } from '@crewstation/contracts';
import { assertPinnedVolume } from './pinnedVolume';
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

test('Bot verifies its private PVC independently of the shared project workspace', async () => {
  const k8s = createFakeK8sClient(), ownerTaskId = TaskIdSchema.parse('01a0bf5d-8f4b-7001-8458-107366e7de39');
  const botContext = { version: 1 as const, ownerTaskId, conversationId: '01a0bf5d-8f4b-7001-8458-107366e7de40', epoch: 1, mode: 'existing' as const, pvcName: `bot-${ownerTaskId.replaceAll('-', '')}`, volumeUid: 'private-original' };
  const render = { ...pod, workload: 'dev-session', botContext, consumerVolumeUid: 'private-original' };
  await k8s.create(volume);
  await expect(assertPinnedVolume(k8s, render)).rejects.toThrow('卷实例已变化');
  await k8s.create({ ...volume, metadata: { ...volume.metadata, name: botContext.pvcName, uid: 'private-original', labels: { 'crewstation.io/task': ownerTaskId } } });
  await assertPinnedVolume(k8s, render);
  await k8s.mergePatch(Resources.PersistentVolumeClaim!, botContext.pvcName, pod.namespace, { metadata: { uid: 'same-name-replacement' } });
  await expect(assertPinnedVolume(k8s, render)).rejects.toThrow('卷实例已变化');
  await expect(assertPinnedVolume(k8s, { ...render, consumerVolumeUid: 'wrong' })).rejects.toThrow('Bot 上下文卷实例已变化');
});
