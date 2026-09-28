import { OperatorArchivePlanSchema } from '@crewstation/contracts';
import { conflict, jsonHash, newResourceId, notFound, precondition } from '@crewstation/kernel';
import type { ArchiveAdministrationApi } from '../api/archiveAdministrationApi';
import type { ArchiveServiceDeps } from './archiveService';
import type { ProjectAuthorizer } from '../ports/platform';
import type { ArchiveBindingRepository } from '../ports/archiveBindings';
import type { ArchiveLossRepository } from '../ports/archiveLoss';
import { archiveLossAdministration } from './archive/lossAdministration';
import { archiveRevisionPreview } from './archive/revisionPreview';

export function archiveAdministration(deps: Pick<ArchiveServiceDeps, 'catalog' | 'plans' | 'tasks'> & { authorizer: ProjectAuthorizer; bindings?: Pick<ArchiveBindingRepository, 'get'> & Partial<Pick<ArchiveBindingRepository, 'deleteArtifacts'>>; loss?: ArchiveLossRepository }): ArchiveAdministrationApi {
  const context = async (actor: Parameters<ArchiveAdministrationApi['preflight']>[0], scope: Parameters<ArchiveAdministrationApi['preflight']>[1]) => {
    await deps.authorizer.authorize(actor, scope.projectId, 'manage-task-storage');
    const task = await deps.tasks.read(scope.serviceId, scope.taskId);
    if (!task || task.projectId !== scope.projectId) throw notFound('业务任务');
    if (task.completionPolicy !== 'archive-and-delete') throw precondition('旧策略任务不能代为归档终结');
    const space = await deps.catalog.serviceSpace(scope.serviceId, 'production');
    if (!space || space.projectId !== scope.projectId) throw precondition('任务对象空间尚未供给');
    return space;
  };
  return {
    deleteArtifacts: async (actor, scope, id, input) => {
      const space = await context(actor, scope);
      if (!deps.bindings?.deleteArtifacts) throw precondition('产物集管理尚未就绪');
      return deps.bindings.deleteArtifacts(id, input, { spaceId: space.id, taskId: scope.taskId, actorId: actor.userId });
    },
    ...archiveLossAdministration({ ...deps, context }),
    assessRevision: archiveRevisionPreview({ ...deps, context }),
    preflight: async (actor, scope, archive) => {
      const space = await context(actor, scope);
      if ('planId' in archive) {
        const plan = await deps.plans.get(archive.planId);
        if (!plan || plan.taskId !== scope.taskId || plan.spaceId !== space.id) throw notFound('归档清单');
        if (plan.state !== 'sealed' || plan.revision !== archive.planRevision || plan.digest !== archive.digest) throw conflict('归档清单尚未封存或已变化', { code: 'storage_revision_conflict' });
      }
      return { spaceId: space.id };
    },
    createPlan: async (actor, scope, input) => {
      const space = await context(actor, scope), request = OperatorArchivePlanSchema.parse(input);
      const authority = { source: { projectId: scope.projectId, serviceId: scope.serviceId, env: 'production' as const, fenced: false }, operator: { userId: actor.userId, reason: request.reason } };
      const plan = await deps.plans.create(space.id, scope.taskId, newResourceId(), request.requestKey, authority), key = jsonHash({ entries: request.entries, reason: request.reason });
      // Fixed revision/key values make a lost append/seal reply replay the same explicit selection.
      await deps.plans.append(plan.id, { requestKey: `operator-page:${key}`, expectedRevision: 1, page: 0, entries: request.entries }, authority);
      const sealed = await deps.plans.seal(plan.id, `operator-seal:${key}`, 2, authority);
      return { id: sealed.id, taskId: sealed.taskId, revision: sealed.revision, state: sealed.state, digest: sealed.digest, itemCount: sealed.itemCount, byteCount: sealed.byteCount, createdAt: sealed.createdAt };
    },
  };
}
