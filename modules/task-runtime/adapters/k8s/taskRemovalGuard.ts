import type { K8sClient, K8sObject } from '@crewstation/k8s';
import { Resources } from '@crewstation/k8s';
import { DEVELOPMENT_PARENT_ENDING_ANNOTATION, DEVELOPMENT_REMOVAL_ANNOTATION } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { DevelopmentRemovalDecision, DevelopmentRemovalTarget } from '../../ports/cluster';
export type TaskDevelopmentRemovalQuery = (target: DevelopmentRemovalTarget) => Promise<DevelopmentRemovalDecision>;

/** Every actual factory keeps UID+RV CAS. A marker recognizes protected scope and can never grant deletion. */
export async function taskRemovalVersion(k8s: K8sClient, kind: 'Pod' | 'Secret', object: K8sObject, query?: TaskDevelopmentRemovalQuery): Promise<string | undefined> {
  const namespace = object.metadata.namespace, uid = object.metadata.uid;
  if (!namespace || !uid) throw precondition('实际删除对象缺少实例或命名空间');
  const marker = object.metadata.annotations?.[DEVELOPMENT_PARENT_ENDING_ANNOTATION] !== undefined || object.metadata.annotations?.[DEVELOPMENT_REMOVAL_ANNOTATION] !== undefined;
  if (!query) {
    if (marker) throw precondition('原开发删除来源未装配，保留原对象');
    return object.metadata.resourceVersion;
  }
  const decision = await query({ kind, namespace, name: object.metadata.name, uid, operation: 'delete' });
  if (decision.kind === 'absent') {
    if (await k8s.get(Resources[kind]!, object.metadata.name, namespace)) throw precondition('原开发删除目标读证发生竞争');
    return undefined;
  }
  if (decision.kind === 'waiting' || decision.kind === 'unselected' && marker) throw precondition('原开发数字或物理退出仍等待确认');
  if (decision.kind === 'permitted') {
    if (decision.resourceVersion !== object.metadata.resourceVersion) throw precondition('原开发对象版本已变化，等待新鲜 CAS');
    return decision.resourceVersion;
  }
  return object.metadata.resourceVersion;
}
