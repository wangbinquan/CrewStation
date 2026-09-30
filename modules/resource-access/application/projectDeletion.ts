import type { ProjectDeletionContext, ProjectDeletionOwner } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { ResourceAccessDeletionRepository } from '../ports/deletion';
import type { ResourceAccessDeps } from './dependencies';
import { adapterOf } from './access';

export function resourceAccessDeletionOwner(repository: ResourceAccessDeletionRepository, assertGrant: (context: ProjectDeletionContext) => Promise<void>, deps: ResourceAccessDeps): ProjectDeletionOwner {
  return { participant: 'resource-access', inspect: repository.inspect, run: async (context) => {
    await assertGrant(context); if (context.confirmed.participant !== 'resource-access') throw precondition('清理许可不属于资源申请 owner');
    if (context.phase === 'seal') {
      for (const work of await repository.unprotectedWork(context)) {
        const change = await deps.repository.get(work.changeId);
        if (!change || change.projectId !== context.target.id) throw precondition('原在途资源申请归属缺失');
        const receipt = await adapterOf(deps, change.target).recover?.(change.projectId, change.id);
        // recover 是原 operationId 的领域写入回执；没有回执时连接或租约消失不能算退出。
        if (receipt) await repository.recoverWork(context, change.id, work.generation, jsonHash(receipt));
      }
      const result = await repository.seal(context);
      if (result === 'waiting') return { kind: 'waiting', reason: '已关闭新应用；原资源申请仍有持久在途事实，等待实际回调退出或原操作恢复证明' };
      if (result === 'changed') return { kind: 'blocked', blockers: [{ participant: 'resource-access', code: 'inventory-changed', message: '申请或实际应用回执在确认后变化；已关闭准入，需要重新核对范围' }] };
    } else await repository.assertSealed(context);
    if (context.phase === 'metadata') await repository.purge(context);
    if (context.phase === 'verify' && (await repository.inspect(context.target)).resources.some((r) => r.count !== 0)) return { kind: 'blocked', blockers: [{ participant: 'resource-access', code: 'content-remains', message: '资源申请或快照仍有残留' }] };
    const metadata = ['seal', 'metadata', 'verify'].includes(context.phase);
    return { kind: 'done', evidence: { kind: metadata ? 'metadata' : 'not-applicable', digest: jsonHash({ participant: 'resource-access', operationId: context.operationId, phase: context.phase }), count: metadata ? context.confirmed.resources.reduce((n, r) => n + r.count, 0) : 0,
      description: context.phase === 'seal' ? '在途应用已退出，资源申请持久准入屏障生效' : context.phase === 'metadata' ? '本项目申请、确认、审批、快照和回执全部清除；全局目录保留' : context.phase === 'verify' ? '申请内容复盘归零，最小旧 ID 阻止重放' : '本模块没有独立物理存储或执行；资源实际回收由对应 owner 证明' } };
  } };
}
