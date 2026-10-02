import type { ProjectDeletionOwner, ProjectDeletionStepResult } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { ClusterDeletionRepository } from '../ports/repository';

export function clusterManagementDeletionOwner(repository: ClusterDeletionRepository): ProjectDeletionOwner {
  const done = (phase: string, operationId: string, count: number): ProjectDeletionStepResult => ({ kind: 'done', evidence: {
    kind: ['seal', 'stop', 'metadata', 'verify'].includes(phase) ? 'metadata' : 'not-applicable', count,
    digest: jsonHash({ participant: 'cluster-management', operationId, phase, count, remaining: 0 }),
    description: phase === 'stop' ? '原集群操作回调已实际退出，封闭后不能再执行' : phase === 'metadata' || phase === 'verify' ? '共享快照中的项目内容、旧版备份和指标明细已清除，其他项目保留'
      : phase === 'seal' ? '本项目集群操作准入和迟到观测写入已封闭' : '集群对象、卷和命名空间由 cluster-control 的原 UID 清理负责',
  } });
  return { participant: 'cluster-management', inspect: async (target) => (await repository.inspect(target)).inventory, run: async (context) => {
    if (context.phase === 'seal') {
      const sealed = await repository.seal(context);
      if (sealed === 'waiting') return { kind: 'waiting', reason: '正在等待原集群操作回调退出；其他项目可以继续运行' };
      if (!sealed) return { kind: 'blocked', blockers: [{ participant: 'cluster-management', code: 'cluster-inventory-changed', message: '确认后集群内容已变化；写入已封闭，需重新核对' }] };
      return done(context.phase, context.operationId, context.confirmed.resources.reduce((sum, entry) => sum + entry.count, 0));
    }
    const stored = await repository.load(context);
    if (!stored.verified) throw precondition('集群内容原范围尚未完整确认');
    if (stored.completed) {
      if (context.phase !== 'verify') throw precondition('集群内容清理已完成，不能重开原阶段');
      return { kind: 'done', evidence: { kind: 'metadata', digest: stored.completed.digest, count: stored.completed.count, description: '原集群内容清理已最终复核' } };
    }
    if (context.phase === 'stop') {
      if (!await repository.stop(context)) return { kind: 'waiting', reason: '原集群操作回调尚未实际退出；租约和连接消失不代表排空' };
    } else if (context.phase === 'purge' || context.phase === 'prove') await repository.record(context);
    else if (context.phase === 'namespace') { if (!stored.proved) throw precondition('集群内容尚未完成前序阶段'); }
    else if (context.phase === 'metadata') return done(context.phase, context.operationId, await repository.purge(context));
    else if (context.phase === 'verify') {
      if (!stored.metadataPurged) throw precondition('集群内容尚未清理');
      const current = await repository.inspect(context.target);
      if (!current.inventory.complete || current.inventory.resources.length) return { kind: 'blocked', blockers: [{ participant: 'cluster-management', code: 'cluster-content-remains', message: '集群历史、旧版备份或指标仍有项目内容' }] };
      const result = done(context.phase, context.operationId, stored.cleanedCount);
      if (result.kind === 'done') await repository.complete(context, result.evidence.digest);
      return result;
    }
    return done(context.phase, context.operationId, 0);
  } };
}
