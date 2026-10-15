import type { K8sClient, K8sObject, ResourceRef } from '@crewstation/k8s';
import { LABELS } from '@crewstation/k8s';
import { precondition } from '@crewstation/kernel';
import { rebuildLabelsMatch } from '../../domain/physicalIdentity';
import type { EnvironmentRebuild } from '../../domain/environmentRebuild';

export const rebuildLabel = 'crewstation.io/rebuild';
export function assertRebuildObject(object: K8sObject, record: EnvironmentRebuild, expectedUid?: string): string {
  const uid = object.metadata.uid;
  if (!uid || !rebuildLabelsMatch(object.metadata.labels?.[LABELS.task], object.metadata.labels?.[rebuildLabel], record) || (expectedUid && uid !== expectedUid)) {
    throw precondition('恢复资源的实例或归属已变化，已停止操作');
  }
  return uid;
}

/** 只清理当前恢复请求创建的实例；删除未完成时继续补偿，不释放准入。 */
export async function removeRebuildObject(k8s: K8sClient, ref: ResourceRef, name: string, record: EnvironmentRebuild, expectedUid?: string): Promise<void> {
  const object = await k8s.get(ref, name, record.namespace);
  if (!object) return;
  const uid = assertRebuildObject(object, record, expectedUid);
  if (!object.metadata.deletionTimestamp) await k8s.delete(ref, name, record.namespace, { gracePeriodSeconds: 30, preconditions: { uid } });
  if (await k8s.get(ref, name, record.namespace)) throw precondition('正在清理本次恢复创建的容器，请稍后查看');
}
