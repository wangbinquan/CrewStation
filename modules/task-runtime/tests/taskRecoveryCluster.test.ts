import { expect, test } from 'bun:test';
import { createFakeK8sClient, LABELS, Resources } from '@crewstation/k8s';
import type { K8sClient } from '@crewstation/k8s';
import { kubernetesTaskRecoveryCluster } from '../adapters/k8s/taskRecoveryCluster';
import type { TaskEnvironment } from '../domain/taskEnvironment';

const env = { id: 'tsk_qa', podName: 'task-qa', pvcName: 'task-qa-work', namespace: 'cs-qa' } as TaskEnvironment;
async function fixture() {
  const k8s = createFakeK8sClient();
  await k8s.create({ apiVersion: 'v1', kind: 'Pod', metadata: { name: env.podName, namespace: env.namespace, uid: 'old-pod' }, status: { phase: 'Failed' } });
  await k8s.create({ apiVersion: 'v1', kind: 'PersistentVolumeClaim', metadata: { name: env.pvcName, namespace: env.namespace, uid: 'kept-volume', labels: { [LABELS.task]: env.id } }, status: { phase: 'Bound', capacity: { storage: '10Gi' } } });
  return { k8s, cluster: kubernetesTaskRecoveryCluster(k8s) };
}

test('恢复检查返回实际工作卷实例和容量，删除失败 Pod 后原卷完全保持', async () => {
  const { k8s, cluster } = await fixture();
  const before = await k8s.get(Resources.PersistentVolumeClaim!, env.pvcName, env.namespace);
  expect(await cluster.inspect(env)).toEqual({ pod: { uid: 'old-pod', phase: 'Failed', deleting: false }, volume: { uid: 'kept-volume', phase: 'Bound', deleting: false, belongsToTask: true, capacity: '10Gi' } });
  await cluster.removeFailedPod(env, 'old-pod'); await cluster.removeFailedPod(env, 'old-pod');
  expect((await cluster.inspect(env)).pod).toBeNull();
  expect(await k8s.get(Resources.PersistentVolumeClaim!, env.pvcName, env.namespace)).toEqual(before);
  expect(k8s.deleted).toEqual(['v1/Pod/cs-qa/task-qa']);
});

test('原容器被替换、仍运行或读取失败都不删除，不把查询失败当作缺卷', async () => {
  const { k8s, cluster } = await fixture();
  await expect(cluster.removeFailedPod(env, 'other-pod')).rejects.toMatchObject({ kind: 'precondition' });
  await k8s.mergePatch(Resources.Pod!, env.podName, env.namespace, { status: { phase: 'Running' } });
  await expect(cluster.removeFailedPod(env, 'old-pod')).rejects.toThrow('尚未结束');
  const unavailable: K8sClient = { ...k8s, get: async () => { throw new Error('API Server unavailable'); } };
  await expect(kubernetesTaskRecoveryCluster(unavailable).inspect(env)).rejects.toThrow('API Server unavailable');
  expect(k8s.deleted).toEqual([]);
});

test('检查与删除之间的实例变化由 API 前置条件拦截，不能误删新 Pod', async () => {
  const { k8s } = await fixture();
  const racing: K8sClient = { ...k8s, delete: async (ref, name, namespace, options) => {
    await k8s.mergePatch(ref, name, namespace, { metadata: { uid: 'replacement' }, status: { phase: 'Running' } });
    return k8s.delete(ref, name, namespace, options);
  } };
  await expect(kubernetesTaskRecoveryCluster(racing).removeFailedPod(env, 'old-pod')).rejects.toMatchObject({ kind: 'conflict' });
  expect((await k8s.get(Resources.Pod!, env.podName, env.namespace))?.metadata.uid).toBe('replacement');
  expect(k8s.deleted).toEqual([]);
});

test('工作卷删除中、归属变化或状态未知均原样反馈，不推测可以恢复', async () => {
  const { k8s, cluster } = await fixture();
  await k8s.mergePatch(Resources.PersistentVolumeClaim!, env.pvcName, env.namespace, { metadata: { deletionTimestamp: '2026-09-15T10:00:00Z', labels: { [LABELS.task]: 'another-task' } }, status: null });
  expect((await cluster.inspect(env)).volume).toEqual({ uid: 'kept-volume', phase: 'Unknown', deleting: true, belongsToTask: false });
  expect(k8s.deleted).toEqual([]);
});
