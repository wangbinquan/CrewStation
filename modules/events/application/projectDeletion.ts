import type { ProjectDeletionContext, ProjectDeletionOwner } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { EventsDeletionRepository } from '../ports/deletion';

export function eventsDeletionOwner(repository: EventsDeletionRepository, assertGrant: (context: ProjectDeletionContext) => Promise<void>): ProjectDeletionOwner {
  return { participant: 'events',inspect: repository.inspect,run: async (context) => {
    await assertGrant(context); if (context.confirmed.participant !== 'events') throw precondition('清理许可不属于事件 owner');
    if (context.phase === 'seal') {
      const state = await repository.seal(context);
      if (state === 'waiting') return { kind: 'waiting',reason: '新投递已关闭；等待原实际回调退出或原容器物理停止证明' };
      if (state === 'changed') return { kind: 'blocked',blockers: [{ participant: 'events',code: 'inventory-changed',message: '事件、订阅或投递在确认后变化；已关闭准入，需要重新核对范围' }] };
    } else await repository.assertSealed(context);
    if (context.phase === 'metadata') await repository.purge(context);
    if (context.phase === 'verify' && (await repository.inspect(context.target)).resources.some((r) => r.count !== 0)) return { kind: 'blocked',blockers: [{ participant: 'events',code: 'content-remains',message: '事件内容或实际投递仍有残留' }] };
    const metadata = ['seal','metadata','verify'].includes(context.phase);
    return { kind: 'done',evidence: { kind: metadata ? 'metadata' : 'not-applicable',digest: jsonHash({ participant: 'events',operationId: context.operationId,phase: context.phase }),count: metadata ? context.confirmed.resources.reduce((n,r) => n+r.count,0) : 0,
      description: context.phase === 'seal' ? '两端项目的投递准入关闭；原投递实际退出' : context.phase === 'metadata' ? '本项目事件、派生投递及原文全部清除，其他来源和订阅配置保留' : context.phase === 'verify' ? '事件内容归零；最小原 ID 关系阻止迟到重放' : '本模块不拥有独立项目容器或存储，资源回收由其所属 owner 证明' } };
  } };
}
