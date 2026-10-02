import { jsonHash, isPlatformError, precondition } from '@crewstation/kernel';
import { DevelopmentParentRebuildBindingSchema } from '../../../domain/development/parentRebuildBinding';
import type { EnvironmentRebuild } from '../../../domain/environmentRebuild';
import type { DevelopmentParentEndingJobLease } from '../../../ports/developmentParentEndingScope';
import type { RepositoryScope } from '../../../ports/unitOfWork';
import type { TaskRuntimeUseCaseDeps } from '../../dependencies';
import { completedDevelopmentParent, observeCompletedDevelopmentParent } from './completed';
import { requirePublishedParentRebuild } from '../../../domain/development/parentRebuildPublication';
import { nextParentRebuildEnvironment, originalParentRebuildHash, prepareParentRebuildMaterials } from './rebuildMaterials';

export async function withDevelopmentRebuild<T>(deps: TaskRuntimeUseCaseDeps, original: EnvironmentRebuild, identity: DevelopmentParentEndingJobLease,
  operation: (scope: RepositoryScope, record: EnvironmentRebuild) => Promise<T>) {
  return deps.uow.run(async (scope) => {
    await scope.admissions.lock(original.projectId);
    if (!scope.parentEnding) throw precondition('原恢复作业持久事务未装配');
    await scope.parentEnding.rebuildLease.requireCurrent(identity, original.id);
    const record = await scope.rebuilds.get(original.id);
    if (!record || originalParentRebuildHash(record) !== originalParentRebuildHash(original)) throw precondition('原恢复请求不可变材料已变化');
    const result = await operation(scope, record);
    await scope.parentEnding.rebuildLease.requireCurrent(identity, original.id);
    return result;
  });
}
async function publish(deps: TaskRuntimeUseCaseDeps, record: EnvironmentRebuild, identity: DevelopmentParentEndingJobLease): Promise<boolean> {
  const binding = DevelopmentParentRebuildBindingSchema.parse(record.developmentParentBinding);
  const ending = await deps.uow.read.parentEnding?.endings.get(binding.endingId), environment = await deps.uow.read.environments.getById(record.taskId);
  if (!ending || !environment || ending.epochHash !== binding.epochHash) throw precondition('原恢复退出来源尚未恢复');
  if (binding.kind === 'pending-ending') return withDevelopmentRebuild(deps, record, identity, async (scope, current) => {
    const source = await scope.parentEnding!.endings.get(ending.id, true), parent = await scope.environments.getForUpdate(record.taskId);
    if (!source || !parent) throw precondition('原恢复父身份尚未恢复');
    if (source.phase !== 'complete') { await scope.parentEnding!.queue.enqueue(source.id); return false; }
    requirePublishedParentRebuild(parent, current, source); return true;
  });
  const existing = await deps.uow.read.parentEnding?.claims.get(ending.id);
  if (existing?.state === 'published') return withDevelopmentRebuild(deps, record, identity, async (scope, current) => {
    const claim = await scope.parentEnding!.claims.get(ending.id, true), parent = await scope.environments.getForUpdate(record.taskId);
    if (!parent || !claim || claim.state !== 'published' || claim.currentRebuildId !== record.id || claim.revision !== binding.claimRevision) throw precondition('原恢复发布占位已变化');
    requirePublishedParentRebuild(parent, current, ending); return true;
  });
  const source = await completedDevelopmentParent(deps.uow.read, environment, ending);
  if (source.witness.outcome !== 'compensation' || environment.state !== 'failed' || binding.completionWitnessHash !== jsonHash(source.witness)
    || binding.afterTransitionHash !== source.witness.afterTransitionHash || binding.pvcUid !== source.materials.pvc.uid) throw precondition('原已完成恢复绑定不一致');
  await observeCompletedDevelopmentParent(deps, source);
  const materials = await prepareParentRebuildMaterials(deps, ending, environment, record);
  return withDevelopmentRebuild(deps, record, identity, async (scope, current) => {
    const parent = await scope.environments.getForUpdate(record.taskId), original = await scope.parentEnding!.endings.get(ending.id, true);
    const claim = await scope.parentEnding!.claims.get(ending.id, true);
    if (!parent || !original || !claim || claim.state !== 'pending' || claim.currentRebuildId !== record.id || claim.revision !== binding.claimRevision
      || claim.afterTransitionHash !== binding.afterTransitionHash || current.state !== 'queued' || materials.recordHash !== originalParentRebuildHash(current)) throw precondition('原恢复占位或请求已被接续');
    await completedDevelopmentParent(scope, parent, original);
    const now = deps.clock.now(), next = nextParentRebuildEnvironment(parent, materials, now);
    if (!await scope.parentEnding!.claims.publish(claim)) throw precondition('原恢复发布占位发生竞争');
    await scope.quota.acquire(next, materials.limit, '项目并发任务配额已满，原工作卷保持不变');
    await scope.environments.update(next);
    await scope.rebuilds.update({ ...current, updatedAt: now, message: '原完成退出已确认，等待新容器启动' });
    return true;
  });
}
/** Runs before the actual worker's ledger/old-env early returns. Waits complete delivery and are durably refilled. */
export async function publishDevelopmentParentRebuild(deps: TaskRuntimeUseCaseDeps, id: string, identity: DevelopmentParentEndingJobLease): Promise<'legacy' | 'waiting' | 'published'> {
  const record = await deps.uow.read.rebuilds.get(id);
  if (!record || !Object.hasOwn(record, 'developmentParentBinding')) return 'legacy';
  try { return await publish(deps, record, identity) ? 'published' : 'waiting'; }
  catch (error) {
    if (isPlatformError(error) && error.details?.['code'] === 'development_parent_job_lease_lost') throw error;
    await withDevelopmentRebuild(deps, record, identity, async (scope, current) => {
      const now = deps.clock.now(), claim = await scope.parentEnding!.claims.byRequest(id);
      if (claim && claim.state === 'pending' && claim.currentRebuildId === id)
        await scope.parentEnding!.claims.retry(claim, new Date(now.getTime() + 2_000));
      if (current.state === 'queued') await scope.rebuilds.update({ ...current, message: isPlatformError(error) ? error.message : '原恢复来源暂不可用，等待核证', updatedAt: now });
    });
    return 'waiting';
  }
}
