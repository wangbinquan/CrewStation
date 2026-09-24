import { describe, expect, test } from 'bun:test';
import { TASK_RUNNER_COMMAND, taskPodObject, taskPreviewObjects } from './task';

type Spec = { initContainers?: Array<{ name: string; env: unknown[] }>; containers: Array<{ command: string[]; env: unknown[]; envFrom?: unknown; resources: unknown; securityContext: unknown; volumeMounts: unknown }>; volumes: unknown[]; affinity?: unknown };
const base = { name: 'task-1', namespace: 'cs-demo', taskId: 't-1', workload: 'dev-session', project: 'demo', service: 'demo', image: 'task:1', workerUid: 10001, resources: { cpu: '1', memory: '2Gi', storage: '10Gi' }, workVolume: { pvc: 'task-1-work' } } as const;

// 任务容器的 Pod 由 task-runtime 与资源中心的调和器共用这一个构造函数（RFC-025 设计 §6.2）；形状与搬过来之前一致。
describe('任务容器 Pod', () => {
  test('开发会话：Runner 启动路径、root、平台与任务标签、资源、工作卷；有分支时 init 容器检出，令牌只从 Secret 取', () => {
    const pod = taskPodObject({ ...base, env: { CS_RUNNER_TOKEN: 'secret-token' }, checkout: { repoUrl: 'http://git/demo.git', branch: 'main', credentialSecretName: 'git-cred-demo' } });
    const spec = pod.spec as Spec;
    expect(pod.metadata).toMatchObject({ name: 'task-1', namespace: 'cs-demo', labels: { 'app.kubernetes.io/managed-by': 'crewstation', 'crewstation.io/project': 'demo', 'crewstation.io/service': 'demo', 'crewstation.io/workload': 'dev-session', 'crewstation.io/task': 't-1' } });
    expect(spec.containers[0]).toMatchObject({ command: [...TASK_RUNNER_COMMAND], env: [{ name: 'CS_RUNNER_TOKEN', value: 'secret-token' }], resources: { requests: { cpu: '1', memory: '2Gi', 'ephemeral-storage': '10Gi' } }, securityContext: { runAsUser: 0 } });
    expect(spec.containers[0]!.envFrom).toBeUndefined();
    expect(spec.volumes).toEqual([{ name: 'work', persistentVolumeClaim: { claimName: 'task-1-work' } }]);
    expect(spec.initContainers?.[0]?.name).toBe('checkout');
    expect(spec.initContainers?.[0]?.env).toContainEqual({ name: 'CS_GIT_TOKEN', valueFrom: { secretKeyRef: { name: 'git-cred-demo', key: 'token' } } });
    expect(JSON.stringify(spec.initContainers)).toContain('chown -R 10001:10001 /work');
  });

  test('执行环境：环境只从 Runner Secret 引用，钉在原节点，带所属工作区等附加标签；档位测试用临时目录、没有 init 容器', () => {
    const pod = taskPodObject({ ...base, name: 'cli-1', envFromSecret: 'cli-1-runner', nodeName: 'desktop-worker', labels: { 'crewstation.io/workspace-task': 't-parent' } });
    const spec = pod.spec as Spec;
    expect(spec.containers[0]!.env).toEqual([]);
    expect(spec.containers[0]!.envFrom).toEqual([{ secretRef: { name: 'cli-1-runner' } }]);
    expect(spec.affinity).toEqual({ nodeAffinity: { requiredDuringSchedulingIgnoredDuringExecution: { nodeSelectorTerms: [{ matchFields: [{ key: 'metadata.name', operator: 'In', values: ['desktop-worker'] }] }] } } });
    expect(pod.metadata.labels?.['crewstation.io/workspace-task']).toBe('t-parent');
    const test = taskPodObject({ ...base, workVolume: { emptyDir: true } });
    expect((test.spec as Spec).volumes).toEqual([{ name: 'work', emptyDir: {} }]);
    expect((test.spec as Spec).initContainers).toBeUndefined();
  });
});

describe('开发预览', () => {
  test('按任务选 Pod 的 Service；有主机时再给同名、经 ForwardAuth 的 IngressRoute；标签里的工作负载是任务种类', () => {
    const [service, route] = taskPreviewObjects({ name: 'task-1', namespace: 'cs-demo', taskId: 't-1', kind: 'dev-session', targetPort: 3000, route: { host: 'dev.demo.cs.localhost', middlewares: [{ name: 'drop', namespace: 'sys' }, { name: 'auth', namespace: 'sys' }] } });
    expect(service?.spec).toMatchObject({ selector: { 'crewstation.io/task': 't-1' }, ports: [{ port: 80, targetPort: 3000 }] });
    expect(service?.metadata.labels).toMatchObject({ 'crewstation.io/task': 't-1', 'crewstation.io/workload': 'dev-session' });
    expect(route?.spec).toMatchObject({ routes: [{ match: 'Host(`dev.demo.cs.localhost`)', services: [{ name: 'task-1', port: 80, namespace: 'cs-demo' }], middlewares: [{ name: 'drop', namespace: 'sys' }, { name: 'auth', namespace: 'sys' }] }] });
    expect(taskPreviewObjects({ name: 'task-1', namespace: 'cs-demo', taskId: 't-1', kind: 'dev-session', targetPort: 3000 })).toHaveLength(1);
  });
});
