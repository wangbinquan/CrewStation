import type { ProjectDeletionContext, ProjectDeletionOwner, ProjectDeletionStepResult } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { ConfigDeletionRepository } from '../ports/deletion';

export function configDeletionOwner(repository: ConfigDeletionRepository, assertGrant: (context: ProjectDeletionContext) => Promise<void>): ProjectDeletionOwner {
  return { participant: 'config', inspect: (target) => repository.inspect(target.id), run: async (context): Promise<ProjectDeletionStepResult> => {
    await assertGrant(context);
    if (context.confirmed.participant !== 'config') throw precondition('配置清理许可来源不符');
    if (context.phase === 'seal') {
      if (!await repository.seal(context)) return { kind: 'blocked', blockers: [{ participant: 'config', code: 'inventory-changed', message: '配置或历史密钥快照在确认后发生变化；已关闭写入，需要重新核对范围' }] };
    } else await repository.assertSealed(context);
    if (context.phase === 'metadata') await repository.purge(context);
    if (context.phase === 'verify') {
      const report = await repository.inspect(context.target.id);
      if (report.resources.some((r) => r.count !== 0)) return { kind: 'blocked', blockers: [{ participant: 'config', code: 'content-remains', message: '配置定义、当前值或历史快照仍有残留' }] };
    }
    const metadata = ['seal', 'metadata', 'verify'].includes(context.phase);
    return { kind: 'done', evidence: { kind: metadata ? 'metadata' : 'not-applicable', digest: jsonHash({ participant: 'config', operationId: context.operationId, phase: context.phase, remaining: 0 }),
      description: context.phase === 'seal' ? '配置内容表的持久写入屏障生效' : context.phase === 'metadata' ? '当前配置、密钥密文与所有历史快照已清除' : context.phase === 'verify' ? '全部配置内容表复盘归零，保留最小防重放墓碑' : '配置模块没有本阶段独立的物理执行或存储副作用',
      count: metadata ? context.confirmed.resources.reduce((n, r) => n + r.count, 0) : 0 } };
  } };
}
