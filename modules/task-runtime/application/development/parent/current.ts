import { precondition } from '@crewstation/kernel';
import { developmentParentEpochHash, readDevelopmentParentEnding, snapshotDevelopmentParentEpoch } from '../../../domain/development/parentEnding';
import type { TaskEnvironment } from '../../../domain/taskEnvironment';
import type { DevelopmentParentEnding } from '../../../ports/developmentParentEnding';
import type { DevelopmentParentEndingJobLease } from '../../../ports/developmentParentEndingScope';
import type { RepositoryScope } from '../../../ports/unitOfWork';
import type { TaskRuntimeUseCaseDeps } from '../../dependencies';

/** The actual ending job, original Project, Task, epoch and phase guard every state commit. */
export async function withDevelopmentParent<T>(deps: TaskRuntimeUseCaseDeps, id: string, identity: DevelopmentParentEndingJobLease,
  operation: (scope: RepositoryScope, environment: TaskEnvironment, ending: DevelopmentParentEnding) => Promise<T>): Promise<T> {
  const original = await deps.uow.read.parentEnding?.endings.get(id);
  if (!original) throw precondition('原父结束记录尚未恢复');
  return deps.uow.run(async (scope) => {
    await scope.admissions.lock(original.projectId);
    if (!scope.parentEnding) throw precondition('原父结束作业持久事务未装配');
    await scope.parentEnding.lease.requireCurrent(identity, id);
    const environment = await scope.environments.getForUpdate(original.parentId), ending = await scope.parentEnding.endings.get(id, true);
    if (!environment || !ending || environment.projectId !== original.projectId || ending.parentId !== environment.id
      || ending.epochHash !== original.epochHash || environment.native) throw precondition('原父结束作业归属已变化');
    const pointer = readDevelopmentParentEnding(environment);
    if (ending.phase !== 'complete') {
      if (!pointer || pointer.endingId !== ending.id || pointer.epochHash !== ending.epochHash || pointer.phase !== ending.phase
        || developmentParentEpochHash(snapshotDevelopmentParentEpoch(environment, { podUid: ending.epoch.podUid, pvcUid: ending.epoch.pvcUid })) !== ending.epochHash)
        throw precondition('原父封存、实际 Task 或不可变材料不一致');
    }
    const result = await operation(scope, environment, ending);
    await scope.parentEnding.lease.requireCurrent(identity, id);
    return result;
  });
}
export async function advanceDevelopmentParent(scope: RepositoryScope, environment: TaskEnvironment, ending: DevelopmentParentEnding,
  next: Pick<DevelopmentParentEnding, 'phase' | 'status' | 'afterChildId' | 'progress' | 'completionWitness' | 'message' | 'retryAt'>, now: Date): Promise<void> {
  if (!scope.parentEnding || !await scope.parentEnding.endings.progress(ending.id, ending.phase, next, now)) throw precondition('原父退出阶段已被其他作业接续');
  await scope.environments.update({ ...environment, parentEnding: { version: 1, endingId: ending.id, epochHash: ending.epochHash, phase: next.phase },
    updatedAt: now, message: next.message ?? '原父退出作业等待持久证明' });
}
