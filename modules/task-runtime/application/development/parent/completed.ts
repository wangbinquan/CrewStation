import { jsonHash, precondition } from '@crewstation/kernel';
import { originalParentCompletion, requireParentCompletionTransition } from '../../../domain/development/parentCompletion';
import { readDevelopmentParentEnding } from '../../../domain/development/parentEnding';
import { DevelopmentParentMaterialsSchema, preparedDevelopmentParent, requireDevelopmentParentStop } from '../../../domain/development/parentMaterials';
import { requireDevelopmentParentAbsence } from '../../../domain/development/parentAbsence';
import type { TaskEnvironment } from '../../../domain/taskEnvironment';
import type { DevelopmentParentEnding } from '../../../ports/developmentParentEnding';
import type { RepositoryScope } from '../../../ports/unitOfWork';
import type { TaskRuntimeUseCaseDeps } from '../../dependencies';

/** Immutable complete-source verification contains only own SQL reads when called inside a Project transaction. */
export async function completedDevelopmentParent(scope: RepositoryScope, environment: TaskEnvironment, ending: DevelopmentParentEnding) {
  const pointer = readDevelopmentParentEnding(environment), witness = originalParentCompletion(ending.completionWitness, ending);
  const materials = DevelopmentParentMaterialsSchema.parse(ending.progress['materials']);
  preparedDevelopmentParent(ending, materials);
  if (!scope.parentEnding || ending.phase !== 'complete' || ending.status !== 'complete' || !pointer || pointer.phase !== 'complete'
    || pointer.endingId !== ending.id || pointer.epochHash !== ending.epochHash || ending.parentId !== environment.id || ending.projectId !== environment.projectId
    || witness.runnerTokenHash !== environment.runnerTokenHash
    || witness.materialsHash !== jsonHash(materials)) throw precondition('原完成退出及实际 Task 转换不一致');
  requireParentCompletionTransition(environment, ending, witness);
  const summary = await scope.parentEnding.children.summary(ending.id);
  if (summary.count !== ending.memberCount || summary.count !== summary.closed || summary.count !== witness.membership.count
    || summary.digest !== witness.membership.digest || await scope.parentEnding.children.remaining(ending.id)
    || await scope.parentEnding.children.liveUnfinished(ending.id)) throw precondition('原完成固定成员或闭合摘要已变化');
  const objects = await scope.parentEnding.objects.list(ending.id);
  const expected = [{ kind: 'Pod', ...materials.pod }, ...materials.secrets.filter((s) => s.owned).map((s) => ({ kind: 'Secret', ...s }))];
  if (objects.length !== expected.length || expected.some((object) => !objects.some((row) => row.kind === object.kind && row.namespace === materials.namespace
    && row.name === object.name && row.uid === object.uid && row.materialsHash === witness.materialsHash))) throw precondition('原物理索引集合不完整');
  for (const object of objects) requireDevelopmentParentAbsence(object.absence, materials);
  return { ending, witness, materials };
}
/** Never require the deleted old Pod to reappear; check its original proof and fresh absence against the retained PVC. */
export async function observeCompletedDevelopmentParent(deps: Pick<TaskRuntimeUseCaseDeps, 'workloadSafety' | 'developmentParentPhysical'>, source: Awaited<ReturnType<typeof completedDevelopmentParent>>) {
  if (!deps.workloadSafety || !deps.developmentParentPhysical) throw precondition('原完成物理核证来源尚未装配');
  const { ending, witness, materials } = source;
  const stopped = requireDevelopmentParentStop(ending, materials, await deps.workloadSafety.get(ending.id));
  if (jsonHash(stopped.stopProof) !== witness.stopProofHash || jsonHash(stopped.consumer) !== jsonHash(witness.consumer)
    || !await deps.workloadSafety.admissionClosed(ending.id)) throw precondition('原完成独立停止证明已变化');
  requireDevelopmentParentAbsence(await deps.developmentParentPhysical.absent(ending, materials), materials);
}
