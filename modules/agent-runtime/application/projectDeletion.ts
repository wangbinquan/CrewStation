import type { ProjectDeletionContext, ProjectDeletionOwner } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { ComputeDeletionRepository } from '../ports/deletion';

export function computeDeletionOwner(repository: ComputeDeletionRepository, assertGrant: (context: ProjectDeletionContext) => Promise<void>): ProjectDeletionOwner {
  return { participant: 'agent-runtime', inspect: repository.inspect, run: async (context) => {
    await assertGrant(context);
    if (context.confirmed.participant !== 'agent-runtime') throw precondition('清理许可不属于算力分配 owner');
    if (context.phase === 'seal') {
      if (!await repository.seal(context)) return { kind: 'blocked', blockers: [{ participant: 'agent-runtime', code: 'inventory-changed', message: '项目算力分配或操作回执已变化；已关闭准入，需要重新确认' }] };
    } else await repository.assertSealed(context);
    if (context.phase === 'metadata') await repository.purge(context);
    if (context.phase === 'verify' && (await repository.inspect(context.target)).resources.some((r) => r.count !== 0)) return { kind: 'blocked', blockers: [{ participant: 'agent-runtime', code: 'content-remains', message: '项目算力分配或操作回执仍有残留' }] };
    const metadata = ['seal', 'metadata', 'verify'].includes(context.phase);
    return { kind: 'done', evidence: { kind: metadata ? 'metadata' : 'not-applicable', digest: jsonHash({ participant: 'agent-runtime', operationId: context.operationId, phase: context.phase }), count: metadata ? context.confirmed.resources.reduce((n, r) => n + r.count, 0) : 0,
      description: context.phase === 'seal' ? '项目算力分配和构建凭据准入关闭；数据库写入事务已退出' : context.phase === 'metadata' ? '项目算力策略和全部分配回执清除，共享档位与凭据保留' : context.phase === 'verify' ? '项目分配内容归零，原操作标识和项目墓碑阻止迟到写入' : '本模块不拥有项目原生执行或镜像存储；相关进程和物理产物由任务及镜像 owner 证明' } };
  } };
}
