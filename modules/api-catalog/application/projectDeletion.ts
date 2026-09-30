import type { ProjectDeletionContext, ProjectDeletionOwner } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { ApiCatalogDeletionRepository } from '../ports/deletion';

export function apiCatalogDeletionOwner(repository: ApiCatalogDeletionRepository, assertGrant: (context: ProjectDeletionContext) => Promise<void>): ProjectDeletionOwner {
  return { participant: 'api-catalog', inspect: (target) => repository.inspect(target), run: async (context) => {
    await assertGrant(context); if (context.confirmed.participant !== 'api-catalog') throw precondition('API 目录清理许可来源不符');
    if (context.phase === 'seal') {
      if (!await repository.seal(context)) return { kind: 'blocked', blockers: [{ participant: 'api-catalog', code: 'inventory-changed', message: 'API 登记、授权或申请在确认后变化；已关闭写入，需要重新核对范围' }] };
    } else await repository.assertSealed(context);
    if (context.phase === 'metadata') await repository.purge(context);
    if (context.phase === 'verify' && (await repository.inspect(context.target)).resources.some((r) => r.count !== 0)) return { kind: 'blocked', blockers: [{ participant: 'api-catalog', code: 'content-remains', message: 'API 登记、授权、申请或分配回执仍有残留' }] };
    const metadata = ['seal', 'metadata', 'verify'].includes(context.phase);
    return { kind: 'done', evidence: { kind: metadata ? 'metadata' : 'not-applicable', digest: jsonHash({ participant: 'api-catalog', operationId: context.operationId, phase: context.phase }),
      count: metadata ? context.confirmed.resources.reduce((n, r) => n + r.count, 0) : 0,
      description: context.phase === 'seal' ? 'API 目录持久屏障生效，原接口退出可调用目录' : context.phase === 'metadata' ? '本项目所有 API 内容清除；其他调用方的申请保留且关联失效' : context.phase === 'verify' ? 'API 内容表复盘归零，最小原 ID 墓碑阻止迟到重放' : 'API 目录没有本阶段独立的物理执行或存储；路由和事件由其 owner 证明' } };
  } };
}
