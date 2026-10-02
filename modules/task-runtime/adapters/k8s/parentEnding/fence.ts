import type { K8sClient, K8sObject } from '@crewstation/k8s';
import { Resources } from '@crewstation/k8s';
import { WORKLOAD_CONSUMER_ANNOTATION, WORKLOAD_STOP_FINALIZER } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import { DEVELOPMENT_PARENT_ENDING_ANNOTATION } from '../../../domain/development/parentMaterials';
import type { DevelopmentParentMaterials } from '../../../domain/development/parentMaterials';
import type { DevelopmentParentEnding } from '../../../ports/developmentParentEnding';
import { inspectParentMaterials, originalParentObject } from './materials';

export async function requireParentMaterials(k8s: K8sClient, ending: DevelopmentParentEnding, materials: DevelopmentParentMaterials): Promise<void> {
  if (jsonHash(await inspectParentMaterials(k8s, ending)) !== jsonHash(materials)) throw precondition('原父不可变物理来源已变化');
}
async function install(k8s: K8sClient, kind: 'Pod' | 'Secret', namespace: string, object: K8sObject, endingId: string): Promise<void> {
  const annotations = object.metadata.annotations ?? {}, existing = annotations[DEVELOPMENT_PARENT_ENDING_ANNOTATION];
  if (existing !== undefined && existing !== endingId || kind === 'Pod' && annotations[WORKLOAD_CONSUMER_ANNOTATION] !== undefined && annotations[WORKLOAD_CONSUMER_ANNOTATION] !== endingId)
    throw precondition('原父对象已有另一项观察身份，不能覆盖');
  const updates = { ...annotations, [DEVELOPMENT_PARENT_ENDING_ANNOTATION]: endingId, ...(kind === 'Pod' ? { [WORKLOAD_CONSUMER_ANNOTATION]: endingId } : {}) };
  const finalizers = object.metadata.finalizers ?? [];
  await k8s.jsonPatch(Resources[kind]!, object.metadata.name, namespace, [
    { op: 'test', path: '/metadata/uid', value: object.metadata.uid }, { op: 'test', path: '/metadata/resourceVersion', value: object.metadata.resourceVersion },
    { op: 'add', path: '/metadata/annotations', value: updates }, ...(kind === 'Pod' ? [{ op: 'add' as const, path: '/metadata/finalizers', value: [...new Set([...finalizers, WORKLOAD_STOP_FINALIZER])] }] : []),
  ]);
}
/** A new forward observation fence on the still-live original instance; never a historical creation receipt. */
export async function fenceParentObjects(k8s: K8sClient, ending: DevelopmentParentEnding, materials: DevelopmentParentMaterials, current: () => Promise<void>): Promise<void> {
  await current(); await requireParentMaterials(k8s, ending, materials);
  const pod = originalParentObject(await k8s.get(Resources.Pod!, materials.pod.name, materials.namespace), materials.pod, materials.namespace);
  if (pod.metadata.deletionTimestamp && pod.metadata.annotations?.[DEVELOPMENT_PARENT_ENDING_ANNOTATION] !== ending.id) throw precondition('原父已在无本次观察保护下删除，不能补造历史证据');
  await current(); await install(k8s, 'Pod', materials.namespace, pod, ending.id);
  for (const expected of materials.secrets.filter((s) => s.owned)) {
    await current(); const secret = originalParentObject(await k8s.get(Resources.Secret!, expected.name, materials.namespace), expected, materials.namespace);
    await install(k8s, 'Secret', materials.namespace, secret, ending.id);
  }
  await current(); await requireParentMaterials(k8s, ending, materials);
}
