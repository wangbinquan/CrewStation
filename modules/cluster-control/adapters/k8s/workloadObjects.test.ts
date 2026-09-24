import { describe, expect, test } from 'bun:test';
import { runnerSecretObject, volumeObject, workloadPodObject, workloadPreviewObjects } from './workloadObjects';

const pod = { name: 'task-1', namespace: 'cs-demo', taskId: 'rec-1', image: 'task:1', workerUid: 10001, resources: { cpu: '1', memory: '2Gi', storage: '10Gi' }, workload: 'business-task', project: 'demo', service: 'demo', pvc: 'task-1-work', secret: 'task-1-runner-2' };

// RFC-025 I25：调和器渲染工作区容器用与 task-runtime 相同的构造函数；Pod 里没有凭据，凭据只在不可变的 Runner Secret 里。
describe('调和器渲染的工作区对象', () => {
  test('Pod：环境只从这一次启动的 Runner Secret 引用，挂自己的工作卷，工作负载与任务标签照写', () => {
    const object = workloadPodObject(pod);
    const spec = object.spec as { containers: Array<{ env: unknown[]; envFrom?: unknown }>; volumes: unknown[] };
    expect(spec.containers[0]).toMatchObject({ env: [], envFrom: [{ secretRef: { name: 'task-1-runner-2' } }] });
    expect(spec.volumes).toEqual([{ name: 'work', persistentVolumeClaim: { claimName: 'task-1-work' } }]);
    expect(object.metadata.labels).toMatchObject({ 'crewstation.io/workload': 'business-task', 'crewstation.io/task': 'rec-1' });
  });

  test('执行环境（I25 第二步）：Pod 钉在父工作区的节点；附加标签与注解 Pod 和 Runner Secret 都带，平台标签照旧', () => {
    const execution = { ...pod, name: 'cli-1', secret: 'cli-1-runner', nodeName: 'node-a', labels: { 'crewstation.io/workspace-task': 'p' }, annotations: { 'crewstation.io/cli-intent': 'digest' } };
    const object = workloadPodObject(execution);
    expect((object.spec as { affinity: unknown }).affinity).toEqual({ nodeAffinity: { requiredDuringSchedulingIgnoredDuringExecution: { nodeSelectorTerms: [{ matchFields: [{ key: 'metadata.name', operator: 'In', values: ['node-a'] }] }] } } });
    expect(object.metadata.labels).toMatchObject({ 'crewstation.io/workspace-task': 'p', 'crewstation.io/task': 'rec-1', 'crewstation.io/workload': 'business-task' });
    expect(object.metadata.annotations).toEqual({ 'crewstation.io/cli-intent': 'digest' });
    const secret = runnerSecretObject(execution, { CS_RUNNER_TOKEN: 't' });
    expect(secret.metadata).toMatchObject({ name: 'cli-1-runner', labels: { 'crewstation.io/workspace-task': 'p', 'crewstation.io/task': 'rec-1' }, annotations: { 'crewstation.io/cli-intent': 'digest' } });
    expect(workloadPodObject(pod).metadata.annotations).toBeUndefined();
    expect(runnerSecretObject(pod, {}).metadata.annotations).toBeUndefined();
  });

  test('Runner Secret 不可变、带任务标签；工作卷与预览照渲染输入', () => {
    expect(runnerSecretObject(pod, { CS_RUNNER_TOKEN: 't' })).toMatchObject({ kind: 'Secret', immutable: true, stringData: { CS_RUNNER_TOKEN: 't' }, metadata: { name: 'task-1-runner-2', labels: { 'crewstation.io/task': 'rec-1' } } });
    expect(volumeObject({ name: 'task-1-work', namespace: 'cs-demo', size: '10Gi', labels: { 'crewstation.io/task': 'rec-1' } })).toMatchObject({ kind: 'PersistentVolumeClaim', spec: { resources: { requests: { storage: '10Gi' } } }, metadata: { labels: { 'crewstation.io/task': 'rec-1' } } });
    expect(workloadPreviewObjects({ name: 'task-1', namespace: 'cs-demo', taskId: 'rec-1', kind: 'dev-session', targetPort: 3000 }).map((o) => o.kind)).toEqual(['Service']);
  });
});
