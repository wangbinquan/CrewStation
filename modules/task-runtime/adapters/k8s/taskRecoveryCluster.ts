import type { K8sClient, K8sObject } from '@crewstation/k8s';
import { LABELS, Resources } from '@crewstation/k8s';
import { precondition } from '@crewstation/kernel';
import type { PodPhase } from '../../ports/cluster';
import type { TaskRecoveryCluster } from '../../ports/recoveryCluster';

type Pod = K8sObject & { status?: { phase?: string } };
type Volume = K8sObject & { status?: { phase?: string; capacity?: { storage?: string } } };
function phase(pod: Pod): PodPhase {
  const value = pod.status?.phase;
  return value && ['Pending', 'Running', 'Succeeded', 'Failed'].includes(value) ? value as PodPhase : 'Unknown';
}
function uid(object: K8sObject): string {
  if (!object.metadata.uid) throw precondition(`${object.kind} ${object.metadata.name} 缺少实例标识，请重新检查`);
  return object.metadata.uid;
}

/** 同名对象不等于确认过的实例；恢复只清理失败 Pod，工作卷始终保留。 */
export function kubernetesTaskRecoveryCluster(k8s: K8sClient): TaskRecoveryCluster {
  return {
    inspect: async (env) => {
      const [pod, volume] = await Promise.all([
        k8s.get<Pod>(Resources.Pod!, env.podName, env.namespace),
        k8s.get<Volume>(Resources.PersistentVolumeClaim!, env.pvcName, env.namespace),
      ]);
      return {
        pod: pod ? { uid: uid(pod), phase: phase(pod), deleting: Boolean(pod.metadata.deletionTimestamp) } : null,
        volume: volume ? { uid: uid(volume), phase: volume.status?.phase ?? 'Unknown', deleting: Boolean(volume.metadata.deletionTimestamp),
          belongsToTask: volume.metadata.labels?.[LABELS.task] === env.id,
          ...(volume.status?.capacity?.storage ? { capacity: volume.status.capacity.storage } : {}) } : null,
      };
    },
    removeFailedPod: async (env, expectedUid) => {
      const pod = await k8s.get<Pod>(Resources.Pod!, env.podName, env.namespace);
      if (!pod) return;
      if (uid(pod) !== expectedUid) throw precondition('原容器实例已变化，请重新检查恢复对象');
      if (!['Failed', 'Succeeded'].includes(phase(pod))) throw precondition('原容器尚未结束，不能重建');
      await k8s.delete(Resources.Pod!, env.podName, env.namespace, { gracePeriodSeconds: 30,
        preconditions: { uid: expectedUid, ...(pod.metadata.resourceVersion ? { resourceVersion: pod.metadata.resourceVersion } : {}) } });
    },
  };
}
