import type { K8sObject } from '../resources';
import { LABELS } from './labels';
import { serviceObject } from './cluster';
import type { MiddlewareRef } from './traefik';
import { ingressRouteObject } from './traefik';
import type { ContainerSpec } from './workloads';
import { podObject } from './workloads';

/**
 * 显式的 Runner 启动路径与 root 身份（RFC-006 §7.3）：管理员以底座构建的镜像里改过的 USER、ENTRYPOINT、CMD
 * 都影响不到 Runner；Runner 再经 setpriv 把每个 Agent／终端／exec 降到 worker。
 */
export const TASK_RUNNER_COMMAND: readonly string[] = Object.freeze(['/usr/bin/tini', '--', '/opt/crewstation/bin/task-runner']);

/** 开发会话的源码检出：init 容器按分支克隆进工作卷，凭据只进 init 容器（取自按服务的 Secret，键为 `token`）。 */
export interface TaskCheckout {
  readonly repoUrl: string;
  readonly branch: string;
  readonly credentialSecretName: string;
}

/**
 * 任务容器 Pod 的渲染输入（task-runtime 与资源中心的调和器共用一个构造函数，RFC-025 设计 §6.2）。
 * `workload` 是 Pod 的工作负载标签：网关的 Pod 身份索引与项目网络策略认这个名字（业务任务是 `business-task`）。
 */
export interface TaskPodInput {
  readonly name: string;
  readonly namespace: string;
  readonly taskId: string;
  readonly workload: string;
  readonly project: string;
  readonly service: string;
  readonly image: string;
  /** Runner 把 Agent 降到的 worker UID；检出后把工作卷交给它。 */
  readonly workerUid: number;
  readonly resources: { readonly cpu: string; readonly memory: string; readonly storage: string };
  /** 工作目录的卷：任务用自己的 PVC；档位测试用 Pod 内的临时目录（RFC-006 §5.2）。 */
  readonly workVolume: { readonly pvc: string } | { readonly emptyDir: true };
  /** 明文环境变量（旧形状）；新形状的凭据都在 Runner Secret 里，经 `envFromSecret` 引用。 */
  readonly env?: Readonly<Record<string, string>>;
  readonly envFromSecret?: string;
  readonly checkout?: TaskCheckout;
  /** 共享 RWO 工作卷的执行容器与恢复容器钉在原节点。 */
  readonly nodeName?: string;
  /** 附加标签（重建、所属工作区）。 */
  readonly labels?: Readonly<Record<string, string>>;
}

function checkoutContainer(image: string, source: TaskCheckout, uid: number): ContainerSpec {
  const script = [
    'set -eu',
    'if [ -e /work/.git ]; then echo "工作卷已有仓库，跳过克隆"; exit 0; fi',
    'AUTH_URL=$(echo "$CS_REPO_URL" | sed "s#://#://oauth2:${CS_GIT_TOKEN}@#")',
    'for attempt in 1 2 3; do',
    '  if git clone --quiet --depth 50 --branch "$CS_BRANCH" "$AUTH_URL" /work; then break; fi',
    '  if [ "$attempt" = 3 ]; then echo "克隆失败，已重试 3 次" >&2; exit 1; fi',
    '  sleep $((attempt * 5))',
    'done',
    // 凭据不落盘：远端改回不带令牌的地址，容器里 git remote -v 也看不到它。
    'git -C /work remote set-url origin "$CS_REPO_URL"',
    `chown -R ${uid}:${uid} /work`,
  ].join('\n');
  return {
    name: 'checkout',
    image,
    command: ['sh', '-c', script],
    env: [
      { name: 'CS_REPO_URL', value: source.repoUrl },
      { name: 'CS_BRANCH', value: source.branch },
      { name: 'CS_GIT_TOKEN', valueFrom: { secretKeyRef: { name: source.credentialSecretName, key: 'token' } } },
    ],
    volumes: [{ name: 'work', mountPath: '/work' }],
    resources: { cpu: '200m', memory: '256Mi' },
  };
}

/** 任务容器的 Pod：Runner 作 PID 1 之下的主进程，工作卷挂在 /work，有分支时先由 init 容器检出源码。 */
export function taskPodObject(input: TaskPodInput): K8sObject {
  const pod = podObject({
    name: input.name, namespace: input.namespace, image: input.image, imagePullPolicy: 'IfNotPresent', command: [...TASK_RUNNER_COMMAND], runAsUser: 0,
    labels: { [LABELS.project]: input.project, [LABELS.service]: input.service, [LABELS.workload]: input.workload, [LABELS.task]: input.taskId },
    env: Object.entries(input.env ?? {}).map(([name, value]) => ({ name, value })),
    resources: { cpu: input.resources.cpu, memory: input.resources.memory, ephemeralStorage: input.resources.storage },
    volumes: ['emptyDir' in input.workVolume ? { name: 'work', mountPath: '/work', emptyDir: true } : { name: 'work', mountPath: '/work', pvc: input.workVolume.pvc }],
    ...(input.checkout ? { initContainers: [checkoutContainer(input.image, input.checkout, input.workerUid)] } : {}),
  });
  for (const [key, value] of Object.entries(input.labels ?? {})) pod.metadata.labels![key] = value;
  if (input.nodeName) (pod.spec as Record<string, unknown>).affinity = { nodeAffinity: { requiredDuringSchedulingIgnoredDuringExecution: { nodeSelectorTerms: [{ matchFields: [{ key: 'metadata.name', operator: 'In', values: [input.nodeName] }] }] } } };
  if (input.envFromSecret) (pod.spec as { containers: Array<Record<string, unknown>> }).containers[0]!.envFrom = [{ secretRef: { name: input.envFromSecret } }];
  return pod;
}

/** 开发预览：按任务选 Pod 的 Service，有用户域主机时再给一条经 ForwardAuth 的 IngressRoute；两者同名。标签里的工作负载是任务种类。 */
export interface TaskPreviewInput {
  readonly name: string;
  readonly namespace: string;
  readonly taskId: string;
  readonly kind: string;
  readonly targetPort: number;
  readonly route?: { readonly host: string; readonly middlewares: readonly MiddlewareRef[] };
}

export function taskPreviewObjects(input: TaskPreviewInput): K8sObject[] {
  const labels = { [LABELS.task]: input.taskId, [LABELS.workload]: input.kind };
  const service = serviceObject({ name: input.name, namespace: input.namespace, selector: { [LABELS.task]: input.taskId }, port: 80, targetPort: input.targetPort, labels });
  if (!input.route) return [service];
  return [service, ingressRouteObject({ name: input.name, namespace: input.namespace, host: input.route.host, target: { name: input.name, port: 80, namespace: input.namespace }, middlewares: input.route.middlewares.map((entry) => ({ ...entry })), labels })];
}
