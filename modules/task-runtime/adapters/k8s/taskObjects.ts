import type { ContainerSpec, K8sClient, K8sObject } from '@crewstation/k8s';
import { LABELS, ingressRouteObject, podObject, serviceObject } from '@crewstation/k8s';
import type { TaskPodSpec, TaskSourceCheckout } from '../../ports/cluster';

function checkoutContainer(image: string, source: TaskSourceCheckout, uid: number): ContainerSpec {
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


export function taskPodObject({ env, image, envVars, resources, agentEnvSecretName, source, envSecretName }: TaskPodSpec, workerUid: number): K8sObject {
  const pod = podObject({
    name: env.podName, namespace: env.namespace, image, imagePullPolicy: 'IfNotPresent',
    labels: { [LABELS.project]: env.labels[LABELS.project] ?? '', [LABELS.service]: env.labels[LABELS.service] ?? '', [LABELS.workload]: env.kind, [LABELS.task]: env.id },
    env: Object.entries(envVars).map(([name, value]) => ({ name, value })),
    resources: { cpu: resources.cpu, memory: resources.memory, ephemeralStorage: resources.storage },
    volumes: [{ name: 'work', mountPath: '/work', pvc: env.pvcName }],
    ...(source ? { initContainers: [checkoutContainer(image, source, workerUid)] } : {}),
  });
  if (agentEnvSecretName) {
    const spec = pod.spec as { volumes: unknown[]; containers: Array<{ volumeMounts: unknown[] }> };
    spec.volumes.push({ name: 'agent-env', secret: { secretName: agentEnvSecretName, defaultMode: 0o400, optional: true } });
    spec.containers[0]!.volumeMounts.push({ name: 'agent-env', mountPath: '/etc/crewstation', readOnly: true });
  }
  if (env.rebuildId) pod.metadata.labels!['crewstation.io/rebuild'] = env.rebuildId;
  if (envSecretName) (pod.spec as { containers: Array<Record<string, unknown>> }).containers[0]!.envFrom = [{ secretRef: { name: envSecretName } }];
  return pod;
}

export async function ensureTaskPreview(k8s: K8sClient, { env, previewRoute }: TaskPodSpec): Promise<void> {
      if (env.preview) {
        await k8s.apply(serviceObject({ name: env.podName, namespace: env.namespace, selector: { [LABELS.task]: env.id }, port: 80, targetPort: env.preview.port, labels: { [LABELS.task]: env.id, [LABELS.workload]: env.kind } }));
        // 开发预览的路由随 Pod 生灭：目标 Service 是按任务建的，放进 gateway 的按服务重算里对不上生命周期。
        if (previewRoute) {
          await k8s.apply(ingressRouteObject({
            name: env.podName, namespace: env.namespace, host: previewRoute.host,
            target: { name: env.podName, port: 80, namespace: env.namespace },
            middlewares: [
              { name: previewRoute.dropIdentityHeadersMiddleware, namespace: previewRoute.systemNamespace },
              { name: previewRoute.userAuthMiddleware, namespace: previewRoute.systemNamespace },
            ],
            labels: { [LABELS.task]: env.id, [LABELS.workload]: env.kind },
          }));
        }
      }
}
