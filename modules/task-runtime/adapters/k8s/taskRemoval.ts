import type { K8sClient, ResourceRef } from '@crewstation/k8s';
import { LABELS, Resources } from '@crewstation/k8s';
import { conflict, precondition } from '@crewstation/kernel';
import type { TaskEnvironment } from '../../domain/taskEnvironment';
import { taskLabelMatches } from '../../domain/physicalIdentity';
import { rebuildLabel } from './rebuildObjects';
import { taskRemovalVersion } from './taskRemovalGuard';
import type { TaskDevelopmentRemovalQuery } from './taskRemovalGuard';

async function removeRebuilt(k8s: K8sClient, env: TaskEnvironment, ref: ResourceRef, name: string, query?: TaskDevelopmentRemovalQuery): Promise<void> {
  const object = await k8s.get(ref, name, env.namespace);
  if (!object) return;
  const uid = object.metadata.uid;
  if (!uid || !taskLabelMatches(object.metadata.labels?.[LABELS.task], env) || (object.metadata.labels?.[rebuildLabel] !== env.rebuildId && !(env.legacyCluster?.rebuildId && object.metadata.labels?.[rebuildLabel] === env.legacyCluster.rebuildId))) throw precondition('恢复资源归属已变化，停止释放');
  const resourceVersion = await taskRemovalVersion(k8s, ref.kind as 'Pod' | 'Secret', object, query);
  if (!resourceVersion) return;
  await k8s.delete(ref, name, env.namespace, { gracePeriodSeconds: 30, preconditions: { uid, resourceVersion } });
}

export async function removeTaskPod(k8s: K8sClient, env: TaskEnvironment, query?: TaskDevelopmentRemovalQuery): Promise<void> {
  if (env.rebuildId) {
    await removeRebuilt(k8s, env, Resources.Pod!, env.podName, query);
    await removeRebuilt(k8s, env, Resources.Secret!, `${env.podName}-runner`, query);
  } else {
    const pod = await k8s.get(Resources.Pod!, env.podName, env.namespace);
    if (!pod) return;
    const uid = pod.metadata.uid;
    if (!uid || env.podUid && uid !== env.podUid) throw conflict('原容器实例已变化，停止释放');
    const resourceVersion = await taskRemovalVersion(k8s, 'Pod', pod, query);
    if (!resourceVersion) return;
    await k8s.delete(Resources.Pod!, env.podName, env.namespace, { gracePeriodSeconds: 30, preconditions: { uid, resourceVersion } });
  }
}
