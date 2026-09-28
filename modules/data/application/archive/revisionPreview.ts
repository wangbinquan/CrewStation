import { ArchiveRevisionPreviewRequestSchema } from '@crewstation/contracts';
import type { Actor, FinalizationArchive } from '@crewstation/contracts';
import { conflict, notFound, precondition } from '@crewstation/kernel';
import type { ArchiveAdministrationApi, ArchiveOperatorScope } from '../../api/archiveAdministrationApi';
import type { ArchiveBindingRepository } from '../../ports/archiveBindings';
import type { ArchivePlanRepository } from '../../ports/archivePlans';
import type { ArchiveTaskDirectory } from '../../ports/archiveTasks';
import { discardedRequiredFiles } from '../../domain/archiveRevision';

export function archiveRevisionPreview(deps: { bindings?: Pick<ArchiveBindingRepository, 'get'>; plans: Pick<ArchivePlanRepository, 'get'>; tasks: Pick<ArchiveTaskDirectory, 'accepted'>; context(actor: Actor, scope: ArchiveOperatorScope): Promise<{ id: string }> }): ArchiveAdministrationApi['assessRevision'] {
  return async (actor, scope, id, input) => {
    const request = ArchiveRevisionPreviewRequestSchema.parse(input), space = await deps.context(actor, scope), original = await deps.tasks.accepted(id);
    if (!original || original.id !== id || original.taskId !== scope.taskId || original.serviceId !== scope.serviceId || original.projectId !== scope.projectId || original.spaceId !== space.id) throw notFound('已受理终结');
    const binding = await deps.bindings?.get(id);
    if (binding && (binding.receipt || binding.taskId !== scope.taskId || binding.spaceId !== space.id)) throw precondition('清单已不可修订');
    if ((binding?.revision ?? 1) !== request.expectedRevision) throw conflict('清单修订已变化');
    const entries = async (archive: FinalizationArchive, next: boolean) => {
      if (!('planId' in archive)) return [];
      const plan = await deps.plans.get(archive.planId);
      if (!plan || plan.taskId !== scope.taskId || plan.spaceId !== space.id) throw notFound('任务归档清单');
      if (plan.digest !== archive.digest || next && (plan.state !== 'sealed' || plan.revision !== archive.planRevision)) throw conflict('清单内容或封存状态已变化');
      return plan.entries;
    };
    const [before, after] = await Promise.all([entries(original.archive, false), entries(request.archive, true)]);
    const discarded = discardedRequiredFiles(before, after), end = Math.min(discarded.length, request.offset + request.limit);
    return { operationId: id, revision: request.expectedRevision, taskGeneration: original.taskGeneration, volumeUid: original.volumeUid,
      oldCount: before.length, newCount: after.length, discardedCount: discarded.length, discarded: discarded.slice(request.offset, end), nextOffset: end < discarded.length ? end : null };
  };
}
