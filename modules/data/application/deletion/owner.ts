import { ProjectDeletionContextSchema } from '@crewstation/contracts';
import type { ProjectDeletionOwner } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { DataDeletionRepository, DataProjectDeletion } from '../../ports/deletion/projectDeletion';
export function dataDeletionOwner(repository: DataDeletionRepository, deps: DataProjectDeletion): ProjectDeletionOwner {
  return { participant: 'data', inspect: async target => {
    try { return (await repository.inspect(target)).inventory; }
    catch { return { participant: 'data', revision: jsonHash({ project: target.id, incomplete: true }), complete: false, resources: [], references: [], blockers: [{ participant: 'data', code: 'source-incomplete', message: '数据内容的原归属、完整分页、父链或共享备份未完成核对' }] }; }
  }, run: async raw => {
    const context = ProjectDeletionContextSchema.parse(raw);
    if (context.confirmed.participant !== 'data' || !context.confirmed.complete || context.confirmed.blockers.length || context.confirmed.references.length) throw precondition('data cleanup requires complete original confirmation');
    await deps.sources.assertGrant(context);
    if (context.phase === 'seal') {
      const sealed = await repository.seal(context);
      if (sealed === 'waiting') return { kind: 'waiting', reason: '等待原对象读写请求退出，再固定最终清理范围' };
      if (!sealed) return { kind: 'blocked', blockers: [{ participant: 'data', code: 'inventory-changed', message: '数据确认范围已变化；准入已关闭，需要重新确认' }] };
    }
    const original = await repository.read(context), old = original.proofs[context.phase];
    if (old && context.phase !== 'verify') return { kind: 'done', evidence: old };
    let physical: Awaited<ReturnType<NonNullable<DataProjectDeletion['physics']>['run']>> | undefined;
    if (original.scope.objectsPresent && ['stop','purge','prove','verify'].includes(context.phase)) {
      if (!deps.physics || !original.sourceIdentity) throw precondition('data original physical source is unavailable');
      physical = await deps.physics.run(context,original.scope,original.sourceIdentity);
      if (physical.kind === 'waiting') return { kind: 'waiting', reason: physical.reason };
      if (physical.kind === 'blocked') return { kind: 'blocked', blockers: physical.blockers };
      if (physical.evidence.kind !== 'physical' || physical.sourceIdentity !== original.sourceIdentity || physical.scopeDigest !== original.scope.digest || !physical.producersClosed || !physical.consumersStopped || !physical.independent || !Number.isSafeInteger(physical.remaining) || Number(physical.remaining) < 0 || context.phase !== 'stop' && physical.remaining !== 0) throw precondition('data physical evidence does not close the original source and consumers');
    }
    if (context.phase === 'verify' && (await repository.inspect(context.target)).inventory.resources.some(r => r.scope !== 'physical' && r.count !== 0)) return { kind: 'blocked', blockers: [{ participant: 'data', code: 'content-remains', message: '项目数据、授权、上传或归档内容仍有残留' }] };
    if (old) return { kind: 'done', evidence: old };
    const evidence = physical?.kind === 'done' ? physical.evidence : { kind: context.phase === 'namespace' ? 'not-applicable' as const : 'metadata' as const,
      digest: jsonHash({ project: context.target.id, operationId: context.operationId, scope: original.scope.digest, phase: context.phase }), count: context.phase === 'namespace' ? 0 : original.scope.count,
      description: context.phase === 'seal' ? '项目数据内容持久封写，完整原归属和范围已固定' : context.phase === 'metadata' ? '项目数据与归档内容清除，共享后端、套餐和最小身份保持' : context.phase === 'verify' ? '所有登记数据内容已核对归零，持久墓碑拒绝迟到写入' : context.phase === 'namespace' ? '命名空间由资源和集群 owner 回收' : '原范围不含对象传输或物理文件；数据库和角色由 data-control owner 证明' };
    await deps.sources.assertGrant(context); await repository.record(context,evidence);
    return { kind: 'done', evidence };
  } };
}
