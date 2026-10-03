import { ProjectDeletionContextSchema } from '@crewstation/contracts';
import type { ProjectDeletionEvidence, ProjectDeletionOwner } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { BusinessDeletionRepository } from '../../../ports/deletion/projectDeletion';
import type { BusinessWorkSources } from '../../../ports/deletion/work';

/** Business content is reclaimed only after all original callbacks and the preceding physical owners have finished. */
export function businessDeletionOwner(repository: BusinessDeletionRepository, sources: BusinessWorkSources): ProjectDeletionOwner {
  return { participant: 'business-task', inspect: async (target) => {
    try { return (await repository.inspect(target)).inventory; }
    catch (error) { return { participant: 'business-task', complete: false, resources: [], references: [], revision: jsonHash({ project: target.id, unavailable: true }),
      blockers: [{ participant: 'business-task', code: 'source-unavailable', message: error instanceof Error ? error.message.slice(0, 500) : '业务原来源未完成' }] }; }
  }, run: async (raw) => {
    const context = ProjectDeletionContextSchema.parse(raw);
    if (context.confirmed.participant !== 'business-task' || !context.confirmed.complete || context.confirmed.blockers.length || context.confirmed.references.length)
      throw precondition('业务清理缺少完整原确认');
    await sources.assertGrant(context);
    if (context.phase === 'seal' && !(await repository.seal(context))) return { kind: 'blocked', blockers: [{ participant: 'business-task', code: 'inventory-changed', message: '业务内容在确认后发生变化，准入已封闭，需要重新确认' }] };
    const previous = await repository.proof(context); if (previous) return { kind: 'done', evidence: previous };
    const scope = await repository.scope(context);
    if (context.phase === 'stop') {
      await repository.observe();
      for (const callback of scope.callbacks) if (!(await repository.exited(callback))) return { kind: 'waiting', reason: '等待原业务请求与执行回调的私有 finally；失联和租约过期不算退出' };
      if (await repository.legacyPending(context)) return { kind: 'waiting', reason: '旧协议在途票据仍缺少原回调退出证明' };
    }
    if (context.phase === 'metadata') await repository.purge(context);
    if (context.phase === 'verify' && (await repository.inspect(context.target)).scope.count !== 0)
      return { kind: 'blocked', blockers: [{ participant: 'business-task', code: 'content-remains', message: '完整分页仍有业务内容，不能完成清理' }] };
    const evidence: ProjectDeletionEvidence = { kind: ['purge', 'prove', 'namespace'].includes(context.phase) ? 'not-applicable' : 'metadata', count: ['purge', 'prove', 'namespace'].includes(context.phase) ? 0 : scope.count,
      digest: jsonHash({ operationId: context.operationId, phase: context.phase, scope: scope.digest }),
      description: context.phase === 'stop' ? '所有原业务回调已退出，已核对私有 finally 或受保护原 Pod 的完整停止事实'
        : context.phase === 'metadata' ? '业务历史和正文完整删除，清理范围仅保留数量、摘要及防止旧键重入的最小原归属'
          : ['purge', 'prove', 'namespace'].includes(context.phase) ? '任务容器、工作盘、对象和命名空间由对应物理资源 owner 清理'
            : '业务准入已封闭，完整内容范围和原持久阶段证明已核对' };
    await sources.assertGrant(context); await repository.record(context, evidence); return { kind: 'done', evidence };
  } };
}
