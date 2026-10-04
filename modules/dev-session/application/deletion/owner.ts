import { ProjectDeletionContextSchema } from '@crewstation/contracts';
import type { ProjectDeletionEvidence, ProjectDeletionOwner } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { DevelopmentDeletionRepository } from '../../ports/deletion/projectDeletion';
import type { DevelopmentWorkSources } from '../../ports/deletion/work';

export function developmentDeletionOwner(repository: DevelopmentDeletionRepository, sources: DevelopmentWorkSources): ProjectDeletionOwner {
  return { participant: 'dev-session', inspect: async (target) => {
    try { return (await repository.inspect(target)).inventory; }
    catch (error) { return { participant: 'dev-session', complete: false, resources: [], references: [], revision: jsonHash({ project: target.id, unavailable: true }),
      blockers: [{ participant: 'dev-session', code: 'source-unavailable', message: error instanceof Error ? error.message.slice(0, 500) : '开发原来源未完成' }] }; }
  }, run: async (raw) => {
    const context = ProjectDeletionContextSchema.parse(raw);
    if (context.confirmed.participant !== 'dev-session' || !context.confirmed.complete || context.confirmed.blockers.length || context.confirmed.references.length)
      throw precondition('开发清理缺少完整原确认');
    await sources.assertGrant(context);
    if (context.phase === 'seal' && !(await repository.seal(context))) return { kind: 'blocked', blockers: [{ participant: 'dev-session', code: 'inventory-changed', message: '开发内容在确认后发生变化，准入已封闭，需要重新确认' }] };
    const previous = await repository.proof(context); if (previous) return { kind: 'done', evidence: previous };
    const scope = await repository.scope(context);
    if (context.phase === 'stop') {
      await repository.observe();
      for (const callback of scope.callbacks) if (!(await repository.exited(callback))) return { kind: 'waiting', reason: '等待开发原回调及已发起副作用的私有 finally；请求超时、断线和租约过期不算退出' };
      if (await repository.pending(context)) return { kind: 'waiting', reason: '等待原开发清理尝试的私有 finally，不能并发接续数字排空' };
      if (await repository.legacyPending(context)) return { kind: 'waiting', reason: '原开发执行仍有未收尾记录，需接续原执行停止，不能由逻辑状态证明物理回收' };
      return { kind: 'done', evidence: await repository.captureStopped(context) };
    }
    if (context.phase === 'metadata') await repository.purge(context);
    if (context.phase === 'verify' && (await repository.inspect(context.target)).scope.count !== 0)
      return { kind: 'blocked', blockers: [{ participant: 'dev-session', code: 'content-remains', message: '完整分页仍有开发内容，不能完成清理' }] };
    const delegated = ['purge', 'prove', 'namespace'].includes(context.phase);
    const evidence: ProjectDeletionEvidence = { kind: delegated ? 'not-applicable' : 'metadata', count: delegated ? 0 : scope.count,
      digest: jsonHash({ operationId: context.operationId, phase: context.phase, scope: scope.digest }),
      description: delegated ? '开发任务容器、工作盘、对象和命名空间由对应物理资源 owner 逐项证明'
        : context.phase === 'metadata' ? '开发历史和正文已完整删除，仅保留数量、摘要及阻断旧键写入的最小原归属'
            : '开发准入与原持久阶段证明已核对，全部内容按原身份遍历' };
    await sources.assertGrant(context); await repository.record(context, evidence); return { kind: 'done', evidence };
  } };
}
