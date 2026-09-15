import { expect, test } from 'bun:test';
import { createFakeK8sClient, Resources } from '@crewstation/k8s';
import type { K8sObject } from '@crewstation/k8s';
import { kubernetesTaskCluster } from '../adapters/k8s/taskCluster';
import type { TaskEnvironment } from '../domain/taskEnvironment';

const env = { podName: 'task-qa', namespace: 'cs-qa' } as TaskEnvironment;
async function phase(status: Record<string, unknown>) {
  const k8s = createFakeK8sClient();
  await k8s.create({ apiVersion: 'v1', kind: 'Pod', metadata: { name: env.podName, namespace: env.namespace }, status } as K8sObject);
  return kubernetesTaskCluster(k8s, 10001).podPhase(env);
}

test('容器 OOM 的原因与退出码不能被仅有的 Pod Failed 状态吞掉', async () => {
  // 四窗实机验收 OOMKilled/137，平台原先只存「容器 已Failed」。
  const result = await phase({ phase: 'Failed', containerStatuses: [{ name: 'task-qa', state: { terminated: { reason: 'OOMKilled', exitCode: 137 } } }] });
  expect(result.phase).toBe('Failed');
  expect(result.message).toContain('task-qa');
  expect(result.message).toContain('OOMKilled');
  expect(result.message).toContain('137');
});

test('检出 init 容器失败也保留原因，成功结束的其他容器不被报成故障', async () => {
  const result = await phase({ phase: 'Failed', initContainerStatuses: [{ name: 'checkout', state: { terminated: { reason: 'Error', exitCode: 128 } } }], containerStatuses: [{ name: 'task-qa', state: { terminated: { reason: 'Completed', exitCode: 0 } } }] });
  expect(result.message).toContain('checkout'); expect(result.message).toContain('128');
  expect(result.message).not.toContain('Completed');
});

test('Pod 级驱逐说明与容器失败原因同时保留', async () => {
  const result = await phase({ phase: 'Failed', reason: 'Evicted', message: 'The node was low on resource: memory.', containerStatuses: [{ name: 'task-qa', state: { terminated: { reason: 'Error', exitCode: 137 } } }] });
  expect(result.message).toContain('Evicted'); expect(result.message).toContain('low on resource'); expect(result.message).toContain('137');
});

test('已恢复运行的容器不把 lastState 中的旧 OOM 当成本次失败', async () => {
  const result = await phase({ phase: 'Running', podIP: '10.0.0.4', containerStatuses: [{ name: 'task-qa', state: { running: {} }, lastState: { terminated: { reason: 'OOMKilled', exitCode: 137 } } }] });
  expect(result).toEqual({ phase: 'Running', ip: '10.0.0.4' });
});

test('缺少诊断信息时不编造 OOM 或退出码，Pod 消失仍为 Missing', async () => {
  expect(await phase({ phase: 'Failed' })).toEqual({ phase: 'Failed' });
  const k8s = createFakeK8sClient();
  expect(await kubernetesTaskCluster(k8s, 10001).podPhase(env)).toEqual({ phase: 'Missing' });
  expect(k8s.deleted).toHaveLength(0);
  expect(await k8s.get(Resources.Pod!, env.podName, env.namespace)).toBeUndefined();
});

test('启动等待保留调度和镜像等待原因，恢复后不沿用旧等待状态', async () => {
  const waiting = { name: 'task-qa', state: { waiting: { reason: 'ImagePullBackOff' } } };
  expect(await phase({ phase: 'Pending', conditions: [{ type: 'PodScheduled', status: 'False', reason: 'Unschedulable', message: 'Insufficient cpu' }], containerStatuses: [waiting] }))
    .toEqual({ phase: 'Pending', message: 'Insufficient cpu；task-qa：ImagePullBackOff' });
  expect(await phase({ phase: 'Running', conditions: [{ type: 'PodScheduled', status: 'True' }] })).toEqual({ phase: 'Running' });
});
