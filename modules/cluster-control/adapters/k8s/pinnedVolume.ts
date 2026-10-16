import type { K8sClient, K8sObject } from '@crewstation/k8s';
import { LABELS, Resources } from '@crewstation/k8s';
import { precondition } from '@crewstation/kernel';
import type { WorkloadPodRender } from '../../domain/workloadRender';

/** Resume reads the live API object too; a stale informer cannot authorize mounting a same-name replacement. */
export async function assertPinnedVolume(k8s: K8sClient, pod: WorkloadPodRender, signal?: AbortSignal): Promise<void> {
  const expectedUid = pod.consumerVolumeUid ?? pod.botContext?.volumeUid ?? pod.expectedVolumeUid;
  if (!expectedUid) return;
  const pvc = pod.botContext?.pvcName ?? pod.pvc;
  if (!pvc) throw precondition('缺少已固定身份的工作卷');
  const volume = await k8s.get<K8sObject & { status?: { phase?: string } }>(Resources.PersistentVolumeClaim!, pvc, pod.namespace, signal);
  const owner = pod.botContext?.ownerTaskId ?? pod.businessStorage?.ownerTaskId ?? pod.archive?.ownerTaskId ?? pod.taskId;
  const initializing = !!pod.consumer && (pod.businessStorage?.initialize === true || pod.botContext?.mode === 'create');
  if (pod.botContext && expectedUid !== pod.botContext.volumeUid) throw precondition('Bot 上下文卷实例已变化');
  if (!volume || volume.metadata.uid !== expectedUid || volume.metadata.deletionTimestamp || volume.metadata.labels?.[LABELS.task] !== owner || (!initializing && volume.status?.phase !== 'Bound')) throw precondition('恢复工作卷实例已变化，拒绝创建容器', { code: 'workspace_volume_changed' });
}
