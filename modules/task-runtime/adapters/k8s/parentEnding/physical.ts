import type { K8sClient } from '@crewstation/k8s';
import { Resources } from '@crewstation/k8s';
import { WORKLOAD_CONSUMER_ANNOTATION, WORKLOAD_STOP_FINALIZER } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import { DEVELOPMENT_PARENT_ENDING_ANNOTATION } from '../../../domain/development/parentMaterials';
import type { DevelopmentParentMaterials } from '../../../domain/development/parentMaterials';
import type { DevelopmentParentEnding } from '../../../ports/developmentParentEnding';
import type { DevelopmentParentPhysical } from '../../../ports/developmentParentPhysical';
import type { DevelopmentRemovalDecision, DevelopmentRemovalTarget } from '../../../ports/cluster';
import { fenceParentObjects, requireParentMaterials } from './fence';
import { inspectParentMaterials, originalParentObject } from './materials';

type Query = (target: DevelopmentRemovalTarget) => Promise<DevelopmentRemovalDecision>;
async function volume(k8s: K8sClient, materials: DevelopmentParentMaterials): Promise<void> {
  originalParentObject(await k8s.get(Resources.PersistentVolumeClaim!, materials.pvc.name, materials.namespace, AbortSignal.timeout(15_000)), materials.pvc, materials.namespace);
}
async function removal(k8s: K8sClient, ending: DevelopmentParentEnding, materials: DevelopmentParentMaterials, target: DevelopmentRemovalTarget): Promise<DevelopmentRemovalDecision> {
  if (target.namespace !== materials.namespace) throw precondition('原父目标命名空间不符');
  const expected = target.kind === 'Pod' ? materials.pod : materials.secrets.find((s) => s.name === target.name && s.owned);
  if (!expected || expected.name !== target.name || expected.uid !== target.uid) throw precondition('目标不是原父实际拥有的实例');
  await volume(k8s, materials);
  const actual = await k8s.get(Resources[target.kind]!, target.name, target.namespace, AbortSignal.timeout(15_000));
  if (!actual) return { kind: 'absent' };
  const object = originalParentObject(actual, expected, materials.namespace);
  if (object.metadata.annotations?.[DEVELOPMENT_PARENT_ENDING_ANNOTATION] !== ending.id) throw precondition('原父退出观察元数据缺失或已替换');
  if (target.kind === 'Pod' && (object.metadata.annotations?.[WORKLOAD_CONSUMER_ANNOTATION] !== ending.id
    || !object.metadata.finalizers?.includes(WORKLOAD_STOP_FINALIZER))) throw precondition('原父独立观察保护尚未完整安装');
  if (target.kind === 'Secret' && await k8s.get(Resources.Pod!, materials.pod.name, materials.namespace, AbortSignal.timeout(15_000))) throw precondition('原父 Pod 尚未真正消失');
  return { kind: 'permitted', resourceVersion: object.metadata.resourceVersion! };
}
async function remove(k8s: K8sClient, query: Query, target: DevelopmentRemovalTarget, current: () => Promise<void>): Promise<void> {
  await current(); const decision = await query(target);
  if (decision.kind === 'absent') return;
  if (decision.kind !== 'permitted') throw precondition('等待原父数字成员与物理停止许可');
  await current(); await k8s.delete(Resources[target.kind]!, target.name, target.namespace,
    { gracePeriodSeconds: 30, preconditions: { uid: target.uid, resourceVersion: decision.resourceVersion } });
}
export function kubernetesDevelopmentParentPhysical(k8s: K8sClient, query: Query): DevelopmentParentPhysical {
  return {
    inspect: (ending) => inspectParentMaterials(k8s, ending),
    fence: (ending, materials, current) => fenceParentObjects(k8s, ending, materials, current),
    requestStop: async (ending, materials, current) => {
      await current(); await volume(k8s, materials);
      const actual = await k8s.get(Resources.Pod!, materials.pod.name, materials.namespace, AbortSignal.timeout(15_000));
      if (!actual) return; // Actual absence does not create a Stop proof.
      const pod = originalParentObject(actual, materials.pod, materials.namespace);
      await requireParentMaterials(k8s, ending, materials);
      if (pod.metadata.deletionTimestamp) return; // An accepted DELETE resumes independent proof/absence; never reinstall its finalizer.
      await removal(k8s, ending, materials, { kind: 'Pod', namespace: materials.namespace, name: materials.pod.name, uid: materials.pod.uid, operation: 'delete' });
      await remove(k8s, query, { kind: 'Pod', namespace: materials.namespace, name: materials.pod.name, uid: materials.pod.uid, operation: 'delete' }, current);
    },
    removeSecrets: async (ending, materials, current) => {
      for (const secret of materials.secrets.filter((s) => s.owned)) {
        const target: DevelopmentRemovalTarget = { kind: 'Secret', namespace: materials.namespace, name: secret.name, uid: secret.uid, operation: 'delete' };
        await current(); await removal(k8s, ending, materials, target); await remove(k8s, query, target, current);
      }
    },
    absent: async (_ending, materials) => {
      await volume(k8s, materials);
      const expected = [{ kind: 'Pod' as const, ...materials.pod }, ...materials.secrets.filter((s) => s.owned).map((s) => ({ kind: 'Secret' as const, ...s }))];
      const actual = await Promise.all(expected.map((o) => k8s.get(Resources[o.kind]!, o.name, materials.namespace, AbortSignal.timeout(15_000))));
      if (actual.some(Boolean)) {
        actual.forEach((object, i) => { if (object && object.metadata.uid !== expected[i]!.uid) throw precondition('原父对象的同名实例已被替换'); });
        return undefined;
      }
      return { version: 1, epochHash: materials.epochHash, pvcUid: materials.pvc.uid, observedAt: new Date().toISOString(),
        objects: expected.map((o) => ({ kind: o.kind, namespace: materials.namespace, name: o.name, uid: o.uid, state: 'absent' })) };
    },
    removal: (ending, materials, target) => removal(k8s, ending, materials, target),
  };
}
