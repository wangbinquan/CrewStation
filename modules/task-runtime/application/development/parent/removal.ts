import { WorkloadStartPermitSchema } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import { DevelopmentParentMaterialsSchema, developmentParentConsumer, preparedDevelopmentParent, requireDevelopmentParentStop } from '../../../domain/development/parentMaterials';
import type { DevelopmentRemovalTarget, DevelopmentRemovalDecision } from '../../../ports/cluster';
import type { TaskRuntimeUseCaseDeps } from '../../dependencies';

/** Original indexed objects precede any current Task-name lookup. Historic identity is never replaced by the new epoch. */
export async function indexedDevelopmentParentRemoval(deps: TaskRuntimeUseCaseDeps, target: DevelopmentRemovalTarget): Promise<DevelopmentRemovalDecision | undefined> {
  const store = deps.uow.read.parentEnding;
  if (!store) return undefined;
  const matches = await store.objects.matches(target.kind, target.namespace, target.name);
  if (!matches.length) return undefined;
  const original = matches.filter((object) => object.uid === target.uid);
  if (original.length !== 1 || !deps.developmentParentPhysical || !deps.workloadSafety) return { kind: 'waiting', reason: 'development-parent-original-pending' };
  const object = original[0]!, ending = await store.endings.get(object.endingId);
  if (!ending || !['stop-intent', 'proved', 'complete'].includes(ending.phase) || !ending.membershipFrozen
    || await store.children.remaining(ending.id)) return { kind: 'waiting', reason: 'development-parent-member-or-intent-pending' };
  const summary = await store.children.summary(ending.id), materials = DevelopmentParentMaterialsSchema.parse(ending.progress['materials']);
  const prepared = preparedDevelopmentParent(ending, materials), expected = developmentParentConsumer(ending, materials);
  if (summary.count !== ending.memberCount || summary.closed !== summary.count || object.materialsHash !== prepared.materialsHash
    || jsonHash(ending.progress['prepared']) !== jsonHash(prepared)) throw precondition('原父对象索引、固定成员或受理材料不符');
  const state = await deps.workloadSafety.get(ending.id), start = WorkloadStartPermitSchema.parse(state?.startPermit);
  if (!state?.admissionClosed || !await deps.workloadSafety.admissionClosed(ending.id) || jsonHash(state.consumer) !== jsonHash(expected)
    || start.podUid !== prepared.podUid || start.nodeName !== prepared.nodeName || start.nodeUid !== prepared.nodeUid) throw precondition('原父实际 Start ACK 尚未闭合');
  if (target.kind === 'Secret' || target.operation === 'stop-finalizer') requireDevelopmentParentStop(ending, materials, state);
  return deps.developmentParentPhysical.removal(ending, materials, target);
}
