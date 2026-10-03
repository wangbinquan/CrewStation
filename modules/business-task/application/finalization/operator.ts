import type { Actor, TaskId } from '@crewstation/contracts';
import { AdministrativeArchiveRevisionSchema, AdministrativeFinalizationSchema, ArchiveRevisionPreviewRequestSchema, OperatorArchivePlanSchema } from '@crewstation/contracts';
import { conflict, notFound, precondition } from '@crewstation/kernel';
import type { BusinessStorageOperatorApi } from '../../api/storageOperator';
import type { ProjectAuthorizer } from '../../ports/runtime';
import type { RecoveryQueries } from '../../ports/taskRecovery';
import type { FinalizationOperations } from '../../ports/storage/finalizations';
import type { FinalizationPreparation } from '../../ports/storage/preparation';
import type { BusinessExecutionDeps } from '../execution/dependencies';
import { admissionTaskView } from '../execution/taskView';
import { finalizationRevisions } from './revisions';
import { DeleteArchiveArtifactsSchema } from '@crewstation/contracts';

export function storageOperator(deps: BusinessExecutionDeps & { authorizer: ProjectAuthorizer }, queries: RecoveryQueries, store: FinalizationOperations, ports?: FinalizationPreparation): Omit<BusinessStorageOperatorApi, 'assessStorageLoss' | 'confirmStorageLoss'> {
  const task = async (actor: Actor, taskId: TaskId) => {
    const parent = await queries.task(taskId);
    if (!parent) throw notFound('业务任务');
    await deps.authorizer.authorize(actor, parent.intent.projectId, 'manage-task-storage');
    if (parent.intent.task.completionPolicy !== 'archive-and-delete') throw precondition('此任务沿用旧存储生命周期', { code: 'finalization_policy_required' });
    return parent;
  };
  return {
    deleteStorageArtifacts: async (actor, taskId, input) => {
      const parent = await task(actor, taskId), op = await store.forTask(parent.serviceId, taskId), request = DeleteArchiveArtifactsSchema.parse(input);
      if (!op || op.view.phase !== 'completed' || op.view.receipt?.id !== request.expectedReceiptId) throw precondition('终结回收尚未完成或收据已变化');
      if (!ports?.operatorArchive?.deleteArtifacts) throw precondition('产物集管理尚未就绪');
      return ports.operatorArchive.deleteArtifacts(actor, { projectId: parent.intent.projectId, serviceId: parent.intent.task.serviceId, taskId }, op.id, request);
    },
    previewStorageArchiveRevision: async (actor, taskId, input) => {
      const parent = await task(actor, taskId), op = await store.forTask(parent.serviceId, taskId), request = ArchiveRevisionPreviewRequestSchema.parse(input);
      if (!op || !ports?.operatorArchive?.assessRevision) throw precondition('清单修订预览尚不可用');
      if (op.view.receipt || !['requested', 'draining', 'archiving'].includes(op.view.phase) || op.view.phaseState === 'revising') throw precondition('此终结阶段不可修订清单');
      if (request.expectedRevision !== op.view.revision) throw conflict('终结修订已变化');
      return ports.operatorArchive.assessRevision(actor, { projectId: parent.intent.projectId, serviceId: parent.intent.task.serviceId, taskId }, op.id, request);
    },
    previewStorageFinalization: async (actor, taskId) => {
      const parent = await task(actor, taskId), children = await deps.subtasks.list(parent.serviceId, taskId);
      return { task: await admissionTaskView(deps, parent), projectId: parent.intent.projectId,
        activeExecutions: children.filter((child) => !['succeeded', 'failed', 'cancelled'].includes(child.view.state)).length,
        unknownExecutions: children.filter((child) => child.view.process === 'unknown').length,
        finalization: (await store.forTask(parent.serviceId, taskId))?.view ?? null };
    },
    prepareStorageArchive: async (actor, taskId, input) => {
      const parent = await task(actor, taskId), op = await store.forTask(parent.serviceId, taskId);
      if (op?.view.receipt) throw precondition('已提交收据，不能重新准备清单');
      if (!ports?.operatorArchive) throw precondition('管理归档能力尚未就绪');
      return ports.operatorArchive.createPlan(actor, { taskId, projectId: parent.intent.projectId, serviceId: parent.intent.task.serviceId }, OperatorArchivePlanSchema.parse(input));
    },
    finalizeStorageAsOperator: async (actor, taskId, input) => {
      const parent = await task(actor, taskId), request = AdministrativeFinalizationSchema.parse(input), previous = await store.forTask(parent.serviceId, taskId);
      const { confirmation: _confirm, reason, ...body } = request, authorization = { administrative: { userId: actor.userId, reason } };
      if (previous) return (await store.accept(parent.serviceId, taskId, body, { spaceId: previous.spaceId, volumeUid: previous.volumeUid, authorization })).view;
      if (!ports?.operatorArchive) throw precondition('管理归档能力尚未就绪');
      const { spaceId } = await ports.operatorArchive.preflight(actor, { taskId, projectId: parent.intent.projectId, serviceId: parent.intent.task.serviceId }, request.archive);
      const env = await deps.environments.getEnvironment(taskId);
      if (env && env.projectId !== parent.intent.projectId) throw notFound('业务工作区');
      return (await store.accept(parent.serviceId, taskId, body, { spaceId, volumeUid: env?.businessWorkspace?.volumeUid ?? null, authorization })).view;
    },
    reviseStorageAsOperator: async (actor, taskId, input) => {
      const parent = await task(actor, taskId), request = AdministrativeArchiveRevisionSchema.parse(input);
      if (!ports?.archive.revise || !ports.runtime.archiveExecution?.stop) throw precondition('归档清单修订尚不可用');
      const change = await store.revise(parent.serviceId, taskId, request, { administrative: { userId: actor.userId, reason: request.reason } });
      if (change.state === 'pending') await finalizationRevisions(store, ports, deps.projectWork)(change.finalizationId);
      const current = (await store.revision(change.id))!;
      if (current.state === 'rejected') throw conflict('清单修订未生效', { code: current.errorCode });
      return (await store.get(change.finalizationId))!.view;
    },
  };
}
