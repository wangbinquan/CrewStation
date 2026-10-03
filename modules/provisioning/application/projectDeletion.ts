import { ProjectDeletionContextSchema, ProjectDeletionInventorySchema, PROJECT_DELETION_PHASES } from '@crewstation/contracts';
import type { ProjectDeletionContext, ProjectDeletionEvidence, ProjectDeletionInventory, ProjectDeletionOwner, ProjectDeletionTarget, ProjectId } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import { provisioningCallbackIdentity } from '../domain/projectWork';
import type { InfrastructureCoordinator } from '../domain/infrastructureCoordinator';
import { ProvisioningDeletionScopeSchema } from '../domain/projectDeletion';
import type { InfrastructureContentSource } from '../ports/infrastructureContents';
import type { InfrastructureOriginSources } from '../ports/infrastructureOrigins';
import type { InfrastructureContentRemoval, ProvisioningDeletionRepository } from '../ports/projectDeletion';
import type { ProvisioningProjectWork } from '../ports/projectWork';
import { inspectInfrastructureContents } from './infrastructureInventory';

interface Deps {
  readonly work: ProvisioningProjectWork; readonly source: InfrastructureContentSource; readonly origins: InfrastructureOriginSources;
  readonly removal: InfrastructureContentRemoval; readonly repository: ProvisioningDeletionRepository;
  assertGrant(context: ProjectDeletionContext): Promise<void>;
  coordinator(projectId: ProjectId): Promise<InfrastructureCoordinator | undefined>;
}
export function provisioningDeletionOwner(deps: Deps): ProjectDeletionOwner {
  const collect = async (target: ProjectDeletionTarget, coordinator?: InfrastructureCoordinator) => {
    await deps.repository.registered();
    const infrastructure = await inspectInfrastructureContents(target.id, deps.source, deps.origins, coordinator);
    const callbacks = (await deps.work.history(target.id)).map((row) => ({ id: row.id, identity: provisioningCallbackIdentity(row) }));
    const resources = [...infrastructure.inventory.resources, ...callbacks.map((row) => ({ kind: 'original-callback', ...row, count: 1, scope: 'metadata' as const }))];
    const material = { ...infrastructure.inventory, resources };
    const inventory: ProjectDeletionInventory = ProjectDeletionInventorySchema.parse({ ...material, revision: jsonHash({ projectId: target.id, resources,
      complete: material.complete, references: material.references, blockers: material.blockers }) });
    const contents = [...infrastructure.contents];
    const scope = ProvisioningDeletionScopeSchema.parse({ callbacks, contents, count: resources.reduce((n, row) => n + row.count, 0),
      originDigest: jsonHash({ callbacks, contents }), compacted: false });
    return { inventory, scope };
  };
  const blocked = (code: string, message: string) => ({ kind: 'blocked' as const, blockers: [{ participant: 'provisioning' as const, code, message }] });
  const run: ProjectDeletionOwner['run'] = async (raw) => {
    const context = ProjectDeletionContextSchema.parse(raw);
    if (context.confirmed.participant !== 'provisioning' || !context.confirmed.complete || context.confirmed.blockers.length || context.confirmed.references.length)
      throw precondition('开通清理缺少原完整确认范围');
    await deps.assertGrant(context);
    const coordinator = { projectId: context.target.id, operationId: context.operationId };
    if (context.phase === 'seal') {
      try { await deps.work.close(context); }
      catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === '55P03') return { kind: 'waiting', reason: '等待原开通回调退出排他准入锁' };
        throw error;
      }
      const current = await collect(context.target, coordinator);
      if (!current.inventory.complete || current.inventory.revision !== context.confirmed.revision)
        return blocked('inventory-changed', '开通回调或基础设施内容在确认后变化；已封闭准入，需要重新核对清理范围');
      await deps.repository.bind(context, current.scope);
    }
    const state = await deps.repository.read(context), index = PROJECT_DELETION_PHASES.indexOf(context.phase);
    if (index > 0 && !state.proofs[PROJECT_DELETION_PHASES[index - 1]!]) throw precondition('开通前一阶段的原持久证明缺失');
    const previous = state.proofs[context.phase];
    if (previous) return { kind: 'done', evidence: previous };
    if (context.phase === 'stop') {
      let history = await deps.work.history(context.target.id);
      if (history.some((row) => !row.exited)) { await deps.work.observe(); history = await deps.work.history(context.target.id); }
      if (jsonHash(history.map((row) => ({ id: row.id, identity: provisioningCallbackIdentity(row) }))) !== jsonHash(state.scope.callbacks))
        return blocked('callback-origin-changed', '原开通回调身份缺失或被替换，不能推断已经退出');
      if (history.some((row) => !row.exited)) return { kind: 'waiting', reason: '等待原回调私有 finally 或原容器停止恢复证明' };
    }
    if (context.phase === 'purge') {
      const current = await collect(context.target, coordinator);
      if (!current.inventory.complete) return blocked('content-source-unavailable', '基础设施归属或分页不完整，保留原内容');
      if (current.scope.contents.some((row) => !state.scope.contents.some((original) => row.channel === original.channel && row.id === original.id
        && row.birthDigest === original.birthDigest && row.ownershipDigest === original.ownershipDigest)))
        return blocked('content-origin-changed', '出现未确认或被替换的任务、事件内容，需要重新核对清理范围');
      if (!(await deps.removal.remove(current.scope.contents))) return { kind: 'waiting', reason: '原任务心跳或事件错误仍在变化，等待回调完成后重读' };
    }
    if (context.phase === 'prove' || context.phase === 'verify') {
      const current = await collect(context.target, coordinator);
      if (!current.inventory.complete || current.scope.contents.length || context.phase === 'verify' && current.scope.callbacks.length)
        return blocked('content-remains', '完整复盘仍有任务、事件或开通回调内容，不能标记清理完成');
    }
    if (context.phase === 'metadata') await deps.repository.purgeCallbacks(context);
    const evidence: ProjectDeletionEvidence = { kind: context.phase === 'namespace' ? 'not-applicable' : 'metadata', count: context.phase === 'namespace' ? 0 : state.scope.count,
      digest: jsonHash({ operationId: context.operationId, phase: context.phase, originDigest: state.scope.originDigest }),
      description: context.phase === 'seal' ? '开通持久准入已封闭，原回调及基础设施内容范围已绑定'
        : context.phase === 'stop' ? '所有原开通回调均有私有退出或原容器停止恢复证明'
          : context.phase === 'namespace' ? '共享控制面进程与基础设施表不属于项目独占命名空间，实际资源由对应 owner 证明'
            : context.phase === 'metadata' ? '原开通回调内容已删除，范围压缩为摘要、数量与阶段证明'
              : '完整分页证明项目任务、事件及错误内容已清除，当前协调行留待原子完成' };
    await deps.repository.record(context, evidence); return { kind: 'done', evidence };
  };
  return { participant: 'provisioning', inspect: async (target) => (await collect(target, await deps.coordinator(target.id))).inventory, run };
}
