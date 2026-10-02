import type { ProjectId, RebuildDevSessionRequest } from '@crewstation/contracts';
import { conflict, jsonHash, newResourceId, precondition } from '@crewstation/kernel';
import type { EnvironmentRebuild } from '../../../domain/environmentRebuild';
import { rebuildIsActive, rebuildToDto } from '../../../domain/environmentRebuild';
import { DevelopmentParentRebuildBindingSchema } from '../../../domain/development/parentRebuildBinding';
import { readDevelopmentParentEnding } from '../../../domain/development/parentEnding';
import type { RepositoryScope } from '../../../ports/unitOfWork';
import type { RebuildDependencies } from '../../rebuildInspection';
import { recoverableDevSession, validateRebuild } from '../../rebuildInspection';
import { completedDevelopmentParent, observeCompletedDevelopmentParent } from './completed';
import { admitDevelopmentParentEnding, prepareDevelopmentParentEnding } from './request';

async function claimCompletedParent(scope: RepositoryScope, source: Awaited<ReturnType<typeof completedDevelopmentParent>>, record: EnvironmentRebuild, now: Date) {
  const claims = scope.parentEnding!.claims, old = await claims.get(source.ending.id, true);
  if (old?.state === 'published') throw conflict('原退出已发布另一个恢复 epoch');
  if (old) {
    const previous = await scope.rebuilds.get(old.currentRebuildId);
    if (!previous || rebuildIsActive(previous)) throw conflict('原退出已有另一项恢复受理，请等待其结果');
    if (old.afterTransitionHash !== source.witness.afterTransitionHash) throw conflict('原退出的恢复占位已变化');
  }
  const claim = { sourceEndingId: source.ending.id, currentRebuildId: record.id, revision: (old?.revision ?? 0) + 1,
    afterTransitionHash: source.witness.afterTransitionHash, state: 'pending' as const, retryAt: now };
  if (old ? !await claims.replace(old, claim) : !await claims.insert(claim)) throw conflict('原退出的恢复占位发生竞争');
  return DevelopmentParentRebuildBindingSchema.parse({ version: 1, kind: 'completed-ending', endingId: source.ending.id, epochHash: source.ending.epochHash,
    completionWitnessHash: jsonHash(source.witness), afterTransitionHash: source.witness.afterTransitionHash, pvcUid: source.materials.pvc.uid, claimRevision: claim.revision });
}
/** Selected acceptance performs all physical/profile reads outside Project. The live old Task is only sealed, never replaced here. */
export async function requestDevelopmentParentRebuild(deps: RebuildDependencies, projectId: ProjectId, input: RebuildDevSessionRequest) {
  const original = await recoverableDevSession(deps.uow.read, projectId, input.reason === 'administrator-restart');
  await validateRebuild(deps, original, input);
  const prepared = await prepareDevelopmentParentEnding(deps, original);
  if (!prepared) throw conflict('原工作区退出选择已变化，请重新检查');
  const pointer = readDevelopmentParentEnding(original), ending = pointer?.phase === 'complete' ? await deps.uow.read.parentEnding?.endings.get(pointer.endingId) : undefined;
  const source = ending ? await completedDevelopmentParent(deps.uow.read, original, ending) : undefined;
  if (source) {
    if (source.witness.outcome !== 'compensation' || original.state !== 'failed') throw precondition('仅原已完成失败补偿可再次保卷恢复');
    await observeCompletedDevelopmentParent(deps, source);
  }
  return deps.uow.run(async (scope) => {
    await scope.admissions.lock(projectId);
    const previous = await scope.rebuilds.findRequest(projectId, input.requestId);
    if (previous) {
      if (jsonHash(previous.input) !== jsonHash(input)) throw conflict('该恢复请求编号已用于另一份确认内容');
      return rebuildToDto(previous);
    }
    const current = await recoverableDevSession(scope, projectId, input.reason === 'administrator-restart');
    if (current.id !== original.id || current.updatedAt.toISOString() !== input.expectedUpdatedAt) throw conflict('原工作区确认材料已变化');
    const now = deps.clock.now(), id = newResourceId(), podName = `task-r-${id.replaceAll('-', '')}`;
    const nodeName = source?.materials.nodeName ?? prepared.nodeName;
    let record: EnvironmentRebuild = { id, taskId: current.id, projectId, input, namespace: current.namespace, originalPodName: current.podName,
      podName, pvcName: current.pvcName, secretName: `${podName}-runner`, image: current.render?.image ?? deps.settings.taskImage,
      ...(deps.creation === 'ledger' ? { creation: 'ledger' } : {}), ...(nodeName ? { nodeName } : {}), state: 'queued', createdAt: now, updatedAt: now,
      message: source ? '已受理保留工作卷恢复，等待原完成退出核证' : '已受理保留工作树重建，等待原子执行与工作区退出' };
    if (source) {
      const fresh = await scope.parentEnding!.endings.get(source.ending.id, true);
      if (!fresh) throw precondition('原完成退出记录尚未恢复');
      const verified = await completedDevelopmentParent(scope, current, fresh);
      record = { ...record, developmentParentBinding: await claimCompletedParent(scope, verified, record, now) };
    } else {
      const accepted = await admitDevelopmentParentEnding(scope, prepared, 'rebuild', { rebuildId: id, requestId: input.requestId, input }, now);
      record = { ...record, developmentParentBinding: { version: 1, kind: 'pending-ending', endingId: accepted.ending.id, epochHash: accepted.ending.epochHash } };
    }
    await scope.rebuilds.insert(record);
    if (source) await scope.rebuildQueue.enqueue(id);
    return rebuildToDto(record);
  });
}
