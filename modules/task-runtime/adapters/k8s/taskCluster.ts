import type { ContainerSpec, K8sClient, K8sObject } from '@crewstation/k8s';
import { LABELS, Resources, podObject, pvcObject, serviceObject } from '@crewstation/k8s';
import type { TaskCluster, TaskSourceCheckout } from '../../ports/cluster';

type PodObject = K8sObject & { status?: { phase?: string; podIP?: string; message?: string; reason?: string } };

/** 任务容器 = 项目命名空间里一个 restartPolicy Never 的 Pod + 一个工作卷；标签供网关 Pod 身份索引识别。 */
/**
 * 源码检出 init 容器：按分支浅克隆进工作卷。
 * 只读凭据只出现在这里，长驻容器的环境里没有它——推送由平台在发布时完成，容器内不需要写权限。
 * 卷已有内容时跳过：持久卷模式下容器会重建，重跑不该覆盖开发者未提交的改动。
 */
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

export function kubernetesTaskCluster(k8s: K8sClient, workerUid: number): TaskCluster {
  return {
    ensureVolume: async (env, size) => {
      const existing = await k8s.get(Resources.PersistentVolumeClaim!, env.pvcName, env.namespace);
      if (existing) return;
      await k8s.create(pvcObject({ name: env.pvcName, namespace: env.namespace, size, labels: { [LABELS.task]: env.id, [LABELS.project]: env.labels[LABELS.project] ?? '' } }));
    },
    createPod: async ({ env, image, envVars, resources, agentEnvSecretName, source }) => {
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
      await k8s.create(pod);
      if (env.preview) {
        await k8s.apply(serviceObject({ name: env.podName, namespace: env.namespace, selector: { [LABELS.task]: env.id }, port: 80, targetPort: env.preview.port, labels: { [LABELS.task]: env.id, [LABELS.workload]: env.kind } }));
      }
    },
    podPhase: async (env) => {
      const pod = await k8s.get<PodObject>(Resources.Pod!, env.podName, env.namespace);
      if (!pod) return { phase: 'Missing' };
      const phase = (pod.status?.phase ?? 'Unknown') as Exclude<Awaited<ReturnType<TaskCluster['podPhase']>>['phase'], 'Missing'>;
      return { phase, ...(pod.status?.podIP ? { ip: pod.status.podIP } : {}), ...(pod.status?.message ? { message: pod.status.message } : pod.status?.reason ? { message: pod.status.reason } : {}) };
    },
    deletePod: async (env) => {
      await k8s.delete(Resources.Pod!, env.podName, env.namespace, { gracePeriodSeconds: 30 });
      if (env.preview) await k8s.delete(Resources.Service!, env.podName, env.namespace);
    },
    deleteVolume: async (env) => { await k8s.delete(Resources.PersistentVolumeClaim!, env.pvcName, env.namespace); },
  };
}
