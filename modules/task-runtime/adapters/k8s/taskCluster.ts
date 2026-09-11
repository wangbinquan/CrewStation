import type { K8sClient, K8sObject } from '@crewstation/k8s';
import { LABELS, Resources, podObject, pvcObject, serviceObject } from '@crewstation/k8s';
import type { TaskCluster } from '../../ports/cluster';

type PodObject = K8sObject & { status?: { phase?: string; podIP?: string; message?: string; reason?: string } };

/** 任务容器 = 项目命名空间里一个 restartPolicy Never 的 Pod + 一个工作卷；标签供网关 Pod 身份索引识别。 */
export function kubernetesTaskCluster(k8s: K8sClient): TaskCluster {
  return {
    ensureVolume: async (env, size) => {
      const existing = await k8s.get(Resources.PersistentVolumeClaim!, env.pvcName, env.namespace);
      if (existing) return;
      await k8s.create(pvcObject({ name: env.pvcName, namespace: env.namespace, size, labels: { [LABELS.task]: env.id, [LABELS.project]: env.labels[LABELS.project] ?? '' } }));
    },
    createPod: async ({ env, image, envVars, resources, agentEnvSecretName }) => {
      const pod = podObject({
        name: env.podName, namespace: env.namespace, image, imagePullPolicy: 'IfNotPresent',
        labels: { [LABELS.project]: env.labels[LABELS.project] ?? '', [LABELS.service]: env.labels[LABELS.service] ?? '', [LABELS.workload]: env.kind, [LABELS.task]: env.id },
        env: Object.entries(envVars).map(([name, value]) => ({ name, value })),
        resources: { cpu: resources.cpu, memory: resources.memory, ephemeralStorage: resources.storage },
        volumes: [{ name: 'work', mountPath: '/work', pvc: env.pvcName }],
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
