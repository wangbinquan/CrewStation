import type { Actor, ArchiveLossPageQuery, TaskId } from '@crewstation/contracts';
import { ArchiveLossPageQuerySchema, ConfirmFinalizationLossSchema } from '@crewstation/contracts';
import { conflict, jsonHash, notFound, precondition } from '@crewstation/kernel';
import type { BusinessStorageOperatorApi } from '../../api/storageOperator';
import type { ProjectAuthorizer } from '../../ports/runtime';
import type { FinalizationOperations } from '../../ports/storage/finalizations';
import type { FinalizationPreparation } from '../../ports/storage/preparation';
import type { RecoveryQueries } from '../../ports/taskRecovery';

/** Data's loss receipt is the durable authority. A lost HTTP reply is recovered by workers without browser resubmission. */
export function storageLossOperator(authorizer: ProjectAuthorizer, tasks: RecoveryQueries, store: FinalizationOperations, ports?: FinalizationPreparation): Pick<BusinessStorageOperatorApi, 'assessStorageLoss' | 'confirmStorageLoss'> {
  const context = async (actor: Actor, taskId: TaskId) => {
    const task = await tasks.task(taskId); if (!task) throw notFound('业务任务');
    await authorizer.authorize(actor, task.intent.projectId, 'manage-task-storage');
    const op = await store.forTask(task.serviceId, taskId);
    if (!op || !ports?.operatorArchive?.assessLoss || !ports.operatorArchive.confirmLoss || !ports.archive.lossReceipt) throw precondition('任务尚未受理终结或损失确认能力未就绪');
    return { op, scope: { taskId, projectId: op.projectId, serviceId: op.serviceId }, data: ports.operatorArchive };
  };
  const assess = async (actor: Actor, taskId: TaskId, page: ArchiveLossPageQuery) => {
    const { op, scope, data } = await context(actor, taskId);
    if (!['requested', 'draining', 'archiving'].includes(op.view.phase) || op.view.phaseState === 'revising' || op.view.receipt) throw precondition('当前终结阶段不可确认数据损失');
    const archive = await data.assessLoss!(actor, scope, op.id, op.view.revision, ArchiveLossPageQuerySchema.parse(page));
    const resultsIncomplete = !op.completionScan?.complete, executionStopConfirmed = !!op.evidence.stopProofDigest;
    const digest = jsonHash({ data: archive.assessmentDigest, taskId, generation: op.view.taskGeneration, revision: op.view.revision, resultsIncomplete, executionStopConfirmed });
    return { ...archive, assessmentDigest: digest, resultsIncomplete, executionStopConfirmed, dataDigest: archive.assessmentDigest };
  };
  return {
    assessStorageLoss: async (actor, taskId, page) => { const { dataDigest: _internal, ...preview } = await assess(actor, taskId, page); return preview; },
    confirmStorageLoss: async (actor, taskId, input) => {
      const request = ConfirmFinalizationLossSchema.parse(input), { op, scope, data } = await context(actor, taskId);
      if (request.expectedRevision !== op.view.revision) throw conflict('终结修订已变化');
      // Replays still recheck the caller's current role and the exact original request in data.
      if (await ports!.archive.lossReceipt!(op.id, op.view.revision)) return data.confirmLoss!(actor, scope, op.id, request, null);
      const assessment = await assess(actor, taskId, { offset: 0, limit: 100 });
      if (assessment.assessmentDigest !== request.assessmentDigest) throw conflict('数据损失范围或停止状态已变化，请重新审视', { code: 'archive_loss_assessment_changed' });
      return data.confirmLoss!(actor, scope, op.id, request, assessment.dataDigest);
    },
  };
}
