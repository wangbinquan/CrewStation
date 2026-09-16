import type { K8sClient, K8sObject } from '@crewstation/k8s';
import { LABELS, Resources, pvcObject } from '@crewstation/k8s';
import type { TaskCluster } from '../../ports/cluster';
import { podNameFor } from '../../domain/taskEnvironment';
import { ensureTaskPreview, taskPodObject } from './taskObjects';
import { removeTaskPod } from './taskRemoval';

interface ContainerStatus {
  name: string;
  imageID?: string;
  state?: { terminated?: { reason?: string; exitCode?: number }; waiting?: { reason?: string } };
}
type PodObject = K8sObject & { status?: { phase?: string; podIP?: string; message?: string; reason?: string; conditions?: Array<{ type: string; status: string; reason?: string; message?: string }>; containerStatuses?: ContainerStatus[]; initContainerStatuses?: ContainerStatus[] } };

function podMessage(pod: PodObject): string | undefined {
  const status = pod.status;
  const parts = [status?.reason, status?.message].filter((part): part is string => !!part);
  if (status?.phase === 'Pending') {
    const scheduling = status.conditions?.find((condition) => condition.type === 'PodScheduled' && condition.status === 'False');
    if (scheduling?.message || scheduling?.reason) parts.push(scheduling.message ?? scheduling.reason!);
    for (const container of [...(status.initContainerStatuses ?? []), ...(status.containerStatuses ?? [])]) {
      if (container.state?.waiting?.reason) parts.push(`${container.name}：${container.state.waiting.reason}`);
    }
  }
  if (status?.phase === 'Failed') {
    for (const container of [...(status.initContainerStatuses ?? []), ...(status.containerStatuses ?? [])]) {
      const ended = container.state?.terminated;
      if (!ended || (ended.exitCode === 0 && (!ended.reason || ended.reason === 'Completed'))) continue;
      const details = [ended.reason, ended.exitCode === undefined ? undefined : `退出码 ${ended.exitCode}`].filter(Boolean).join('，');
      if (details) parts.push(`${container.name}：${details}`);
    }
  }
  return [...new Set(parts)].join('；') || undefined;
}


export function kubernetesTaskCluster(k8s: K8sClient, workerUid: number): TaskCluster {
  return {
    ensureVolume: async (env, size) => {
      const existing = await k8s.get(Resources.PersistentVolumeClaim!, env.pvcName, env.namespace);
      if (existing) return;
      await k8s.create(pvcObject({ name: env.pvcName, namespace: env.namespace, size, labels: { [LABELS.task]: env.id, [LABELS.project]: env.labels[LABELS.project] ?? '' } }));
    },
    createPod: async (spec) => {
      await k8s.create(taskPodObject(spec, workerUid));
      await ensureTaskPreview(k8s, spec);
    },
    podPhase: async (env) => {
      const pod = await k8s.get<PodObject>(Resources.Pod!, env.podName, env.namespace);
      if (!pod) return { phase: 'Missing' };
      const phase = (pod.status?.phase ?? 'Unknown') as Exclude<Awaited<ReturnType<TaskCluster['podPhase']>>['phase'], 'Missing'>;
      const message = podMessage(pod);
      const imageId = pod.status?.containerStatuses?.[0]?.imageID;
      return { phase, ...(pod.status?.podIP ? { ip: pod.status.podIP } : {}), ...(message ? { message } : {}), ...(imageId ? { imageId } : {}) };
    },
    deletePod: async (env) => {
      await removeTaskPod(k8s, env);
      if (env.preview) {
        const routeName = env.rebuildId ? podNameFor(env.id) : env.podName;
        await k8s.delete(Resources.Service!, routeName, env.namespace);
        await k8s.delete(Resources.IngressRoute!, routeName, env.namespace);
      }
    },
    deleteVolume: async (env) => { await k8s.delete(Resources.PersistentVolumeClaim!, env.pvcName, env.namespace); },
  };
}
