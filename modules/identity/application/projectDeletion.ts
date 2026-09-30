import type { ProjectDeletionContext, ProjectDeletionOwner, ProjectDeletionStepResult } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { IdentityDeletionRepository } from '../ports/lifecycle/projectDeletion';

export function identityDeletionOwner(repository: IdentityDeletionRepository, assertGrant: (context: ProjectDeletionContext) => Promise<void>): ProjectDeletionOwner {
  return { participant: 'identity', inspect: (target) => repository.inspect(target.id), run: async (context): Promise<ProjectDeletionStepResult> => {
    await assertGrant(context);
    if (context.confirmed.participant !== 'identity') throw precondition('身份清理许可来源不符');
    if (context.phase === 'seal') {
      if (!await repository.seal(context)) return { kind: 'blocked', blockers: [{ participant: 'identity', code: 'inventory-changed', message: '项目身份转发规则在确认后变化；已关闭项目身份准入，需要核对范围' }] };
    } else await repository.assertSealed(context);
    if (context.phase === 'metadata') await repository.purge(context);
    if (context.phase === 'verify' && (await repository.inspect(context.target.id)).resources.some((r) => r.count > 0)) return {
      kind: 'blocked', blockers: [{ participant: 'identity', code: 'content-remains', message: '项目身份转发覆盖仍有残留' }],
    };
    const metadata = ['seal', 'stop', 'metadata', 'verify'].includes(context.phase);
    return { kind: 'done', evidence: { kind: metadata ? 'metadata' : 'not-applicable', digest: jsonHash({ operationId: context.operationId, participant: 'identity', phase: context.phase, remaining: 0 }),
      description: context.phase === 'seal' || context.phase === 'stop' ? '持久墓碑与现查生命周期关闭本项目的令牌签发、来源解析和身份转发' : context.phase === 'metadata' || context.phase === 'verify' ? '项目身份转发覆盖已清除；用户、登录方式及平台签名钥保留' : 'identity 模块没有独立工作负载或数据卷；签名令牌每次使用都重查项目准入',
      count: metadata ? context.confirmed.resources.reduce((n, r) => n + r.count, 0) : 0 } };
  } };
}
