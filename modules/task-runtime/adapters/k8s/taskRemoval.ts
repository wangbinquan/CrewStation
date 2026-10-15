import type { K8sClient, ResourceRef } from '@crewstation/k8s';
import { LABELS, Resources } from '@crewstation/k8s';
import { precondition } from '@crewstation/kernel';
import type { TaskEnvironment } from '../../domain/taskEnvironment';
import { taskLabelMatches } from '../../domain/physicalIdentity';
import { rebuildLabel } from './rebuildObjects';

async function removeRebuilt(k8s: K8sClient, env: TaskEnvironment, ref: ResourceRef, name: string): Promise<void> {
  const object = await k8s.get(ref, name, env.namespace);
  if (!object) return;
  const uid = object.metadata.uid;
  if (!uid || !taskLabelMatches(object.metadata.labels?.[LABELS.task], env) || (object.metadata.labels?.[rebuildLabel] !== env.rebuildId && !(env.legacyCluster?.rebuildId && object.metadata.labels?.[rebuildLabel] === env.legacyCluster.rebuildId))) throw precondition('恢复资源归属已变化，停止释放');
  await k8s.delete(ref, name, env.namespace, { gracePeriodSeconds: 30, preconditions: { uid } });
}

export async function removeTaskPod(k8s: K8sClient, env: TaskEnvironment): Promise<void> {
  if (env.rebuildId) {
    await removeRebuilt(k8s, env, Resources.Pod!, env.podName);
    await removeRebuilt(k8s, env, Resources.Secret!, `${env.podName}-runner`);
  } else await k8s.delete(Resources.Pod!, env.podName, env.namespace, { gracePeriodSeconds: 30, ...(env.podUid ? { preconditions: { uid: env.podUid } } : {}) });
}
