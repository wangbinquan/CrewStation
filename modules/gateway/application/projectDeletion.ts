import type { ProjectDeletionContext, ProjectDeletionOwner } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { GatewayDeletionRepository } from '../ports/repositories';

export function gatewayDeletionOwner(repository: GatewayDeletionRepository, assertGrant: (context: ProjectDeletionContext) => Promise<void>): ProjectDeletionOwner {
  return { participant: 'gateway', inspect: repository.inspect, run: async (context) => {
    await assertGrant(context); if (context.confirmed.participant !== 'gateway') throw precondition('清理许可不属于网关 owner');
    if (context.phase === 'seal') {
      const state = await repository.seal(context);
      if (state === 'waiting') return { kind: 'waiting', reason: '网关准入已关闭，等待原路由回调退出或原容器实际停止证明' };
      if (state === 'changed') return { kind: 'blocked', blockers: [{ participant: 'gateway', code: 'inventory-changed', message: '网关内容或原回调在确认后变化，已关闭准入，需要重新确认' }] };
    } else await repository.assertSealed(context);
    if (context.phase === 'metadata') await repository.purge(context);
    if (context.phase === 'verify') {
      const report = await repository.inspect(context.target);
      if (!report.complete || report.resources.some((r) => r.count !== 0)) return { kind: 'blocked', blockers: report.blockers.length ? report.blockers : [{ participant: 'gateway', code: 'content-remains', message: '项目网关内容或回调事实仍有残留' }] };
    }
    const metadata = ['seal', 'metadata', 'verify'].includes(context.phase);
    return { kind: 'done', evidence: { kind: metadata ? 'metadata' : 'not-applicable', digest: jsonHash({ participant: 'gateway', operationId: context.operationId, phase: context.phase }), count: metadata ? context.confirmed.resources.reduce((n, r) => n + r.count, 0) : 0,
      description: context.phase === 'seal' ? '原项目网关准入关闭，原外部回调实际退出' : context.phase === 'metadata' ? '项目路由期望、身份、维护、限流和全部历史允许关系清除，其他项目原文保留' : context.phase === 'verify' ? '网关内容归零，最小原身份和每请求视图阻止重放及旧缓存放行' : '实际路由和中间件由资源及集群 owner 按原 UID 回收，本内容回执不冒充物理完成' } };
  } };
}
