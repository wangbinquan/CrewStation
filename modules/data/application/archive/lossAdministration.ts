import { notFound, precondition } from '@crewstation/kernel';
import type { Actor } from '@crewstation/contracts';
import type { ArchiveAdministrationApi, ArchiveOperatorScope } from '../../api/archiveAdministrationApi';
import type { ArchiveBindingRepository } from '../../ports/archiveBindings';
import type { ArchiveLossRepository } from '../../ports/archiveLoss';

export function archiveLossAdministration(deps: { bindings?: Pick<ArchiveBindingRepository, 'get'>; loss?: ArchiveLossRepository; context(actor: Actor, scope: ArchiveOperatorScope): Promise<{ id: string }> }): Pick<ArchiveAdministrationApi, 'assessLoss' | 'confirmLoss'> {
  const authorize = async (actor: Actor, scope: ArchiveOperatorScope, id: string) => {
    const space = await deps.context(actor, scope);
    if (!deps.bindings || !deps.loss) throw precondition('数据损失确认能力尚未就绪');
    const binding = await deps.bindings.get(id);
    if (!binding || binding.spaceId !== space.id || binding.taskId !== scope.taskId) throw notFound('任务归档绑定');
    return deps.loss;
  };
  return {
    assessLoss: async (actor, scope, id, revision, page) => {
      const loss = await authorize(actor, scope, id), { spaceId: _space, taskId: _task, ...assessment } = await loss.assess(id, revision, page); return assessment;
    },
    confirmLoss: async (actor, scope, id, input, dataDigest) => (await authorize(actor, scope, id)).confirm(id, actor.userId, input, dataDigest),
  };
}
