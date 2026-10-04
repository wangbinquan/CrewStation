import { ProjectDeletionContextSchema, ProjectDeletionStepResultSchema } from '@crewstation/contracts';
import type { ProjectDeletionEvidence, ProjectDeletionOwner } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { RuntimeDeletionRepository, RuntimeDeletionStop } from '../../ports/deletion/projectDeletion';
import type { RuntimeWorkSources } from '../../ports/deletion/work';

export function runtimeDeletionOwner(repository: RuntimeDeletionRepository, sources: RuntimeWorkSources, stopping: RuntimeDeletionStop): ProjectDeletionOwner {
  return { participant: 'task-runtime', inspect: async (target) => {
    try { return (await repository.inspect(target)).inventory; }
    catch (error) { return { participant: 'task-runtime', complete: false, resources: [], references: [], revision: jsonHash({ project: target.id, unavailable: true }),
      blockers: [{ participant: 'task-runtime', code: 'source-unavailable', message: error instanceof Error ? error.message.slice(0, 500) : '运行原来源未完成' }] }; }
  }, run: async (raw) => {
    const context = ProjectDeletionContextSchema.parse(structuredClone(raw));
    if (context.confirmed.participant !== 'task-runtime' || !context.confirmed.complete || context.confirmed.blockers.length || context.confirmed.references.length)
      throw precondition('运行清理缺少完整原确认');
    await sources.assertGrant(context);
    if (context.phase === 'seal' && !(await repository.seal(context))) return { kind: 'blocked', blockers: [{ participant: 'task-runtime', code: 'inventory-changed', message: '运行内容在确认后发生变化，准入已封闭，需要重新确认' }] };
    const previous = await repository.proof(context); if (previous) return { kind: 'done', evidence: previous };
    const scope = await repository.scope(context);
    if (context.phase === 'stop') {
      await repository.observe();
      for (const callback of scope.callbacks) if (!(await repository.exited(callback))) return { kind: 'waiting', reason: '等待原运行请求与后台回调的私有 finally 或原完整Pod退出' };
      if (await repository.pending(context)) return { kind: 'waiting', reason: '等待此前删除尝试的原回调退出，不能并发接续物理停止' };
      if (!scope.stopped) {
        const result = ProjectDeletionStepResultSchema.parse(await stopping.stop(context, scope)); if (result.kind !== 'done') return result;
        await repository.captureStopped(context, result.evidence);
      }
      const evidence = await repository.proof(context);
      if (!evidence) throw precondition('运行停止范围与原停止证明未原子持久化');
      return { kind: 'done', evidence };
    }
    if (context.phase === 'metadata') {
      const evidence = await repository.purge(context); await sources.assertGrant(context); return { kind: 'done', evidence };
    }
    if (context.phase === 'verify' && (await repository.inspect(context.target)).scope.count !== 0)
      return { kind: 'blocked', blockers: [{ participant: 'task-runtime', code: 'content-remains', message: '完整分页仍有运行内容，不能完成清理' }] };
    const absent = ['purge', 'prove', 'namespace'].includes(context.phase);
    const evidence: ProjectDeletionEvidence = { kind: absent ? 'not-applicable' : 'metadata', count: absent || context.phase === 'verify' ? 0 : scope.stopped?.count ?? scope.count,
      digest: jsonHash({ operationId: context.operationId, phase: context.phase, scope: scope.stopped?.digest ?? scope.digest }),
      description: absent ? '原卷、数据库、对象和命名空间由对应物理资源owner清理'
          : context.phase === 'verify' ? '完整表与列登记、所有原内容EOF复核为空，保留最小防重入身份和删除证明'
            : '运行准入已永久封闭，完整原内容与回调确认范围已绑定' };
    await sources.assertGrant(context); await repository.record(context, evidence); return { kind: 'done', evidence };
  } };
}
