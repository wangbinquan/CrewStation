import type { ProjectDeletionContext, ProjectDeletionInventory, ProjectDeletionOwner, ProjectDeletionStepResult } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import { originalUid } from '../../domain/deletion/objects';
import type { ClusterDeletionAdmission } from '../../api/projectDeletion';
import type { ProjectClusterDeletion } from '../../ports/projectDeletion';
function newlyBoundOriginalClaim(context: ProjectDeletionContext, entry: ProjectDeletionInventory['resources'][number]): boolean {
  if (entry.kind !== 'PersistentVolume') return false;
  const identity = JSON.parse(entry.identity);
  if (!identity.claimUid || identity.claimNamespace !== context.target.namespace) return false;
  if (context.confirmed.resources.some((original) => original.kind === 'PersistentVolume' && JSON.parse(original.identity).claimUid === identity.claimUid)) return false;
  return context.confirmed.resources.some((original) => original.kind === 'PersistentVolumeClaim' && originalUid(original) === identity.claimUid);
}
function changedInstances(context: ProjectDeletionContext, current: ProjectDeletionInventory): ProjectDeletionStepResult | undefined {
  if (current.blockers.length) return { kind: 'blocked', blockers: current.blockers };
  const original = new Map(context.confirmed.resources.map((entry) => [entry.id, entry]));
  const replaced = current.resources.find((entry) => original.has(entry.id) ? originalUid(original.get(entry.id)!) !== originalUid(entry) : !newlyBoundOriginalClaim(context, entry));
  if (replaced) return { kind: 'blocked', blockers: [{ participant: 'cluster-control', code: 'instance-changed', message: '确认范围外的新对象或同名替换实例仍在；停止物理删除，需核对该对象', resourceId: replaced.id }] };
}
export function clusterProjectDeletionOwner(source: ProjectClusterDeletion, admission: ClusterDeletionAdmission): ProjectDeletionOwner {
  return { participant: 'cluster-control', inspect: source.inspect, run: async (context) => {
    await admission.assertGrant(context);
    if (context.confirmed.participant !== 'cluster-control') throw precondition('集群清理许可来源不符');
    if (context.phase === 'seal') {
      await admission.seal(context);
      const current = await source.inspect(context.target);
      if (current.revision !== context.confirmed.revision || current.blockers.length) return { kind: 'blocked', blockers: current.blockers.length ? current.blockers : [{ participant: 'cluster-control', code: 'inventory-changed', message: '原集群对象在确认后发生变化；已关闭项目准入，需核对范围' }] };
    } else await admission.assertSealed(context);
    if (['stop', 'purge', 'prove', 'namespace', 'verify'].includes(context.phase)) {
      let current = await source.inspect(context.target); const blocked = changedInstances(context, current);
      if (blocked) return blocked;
      if (['purge', 'prove'].includes(context.phase)) {
        await source.reclaimObjects(context);
        current = await source.inspect(context.target); const changed = changedInstances(context, current);
        if (changed) return changed;
        if (current.resources.some(entry => ['IngressRoute', 'Middleware', 'Secret'].includes(entry.kind))) return { kind: 'waiting', reason: '原路由、中间件和凭据删除已受理，等待原实例实际消失' };
      }
      if (context.phase === 'stop' && current.resources.some((entry) => ['Pod', 'Deployment', 'ReplicaSet', 'Job'].includes(entry.kind))) return { kind: 'waiting', reason: '等待原工作负载控制器与容器完成停止和消失证明' };
      if (['prove', 'namespace'].includes(context.phase) && current.resources.some((entry) => !['Namespace', 'Service', 'ResourceQuota', 'NetworkPolicy'].includes(entry.kind))) return { kind: 'waiting', reason: '等待原 PVC、PV、凭据和其他项目对象实际回收' };
      if (context.phase === 'namespace') {
        const original = context.confirmed.resources.find((entry) => entry.kind === 'Namespace');
        if (original) { await admission.assertGrant(context); if (!await source.removeNamespace(context, originalUid(original))) return { kind: 'waiting', reason: '命名空间删除已受理，等待原实例完成正常终结' }; }
      }
      if (context.phase === 'verify' && current.resources.length) return { kind: 'waiting', reason: '完整 discovery 复盘仍发现原项目对象，等待清理完成' };
    }
    const physical = ['stop', 'purge', 'prove', 'namespace', 'verify'].includes(context.phase);
    return { kind: 'done', evidence: { kind: physical ? 'physical' : context.phase === 'seal' ? 'metadata' : 'not-applicable',
      digest: jsonHash({ operationId: context.operationId, participant: 'cluster-control', phase: context.phase, original: context.confirmed.revision }),
      description: context.phase === 'seal' ? '集群调和器的持久项目准入已关闭' : context.phase === 'stop' ? '原工作负载控制器与容器已消失；前序 owner 已持久保存停止证明' : context.phase === 'purge' ? '原路由、中间件和凭据按原 UID 回收并经完整 discovery 确认消失' : context.phase === 'prove' ? '完整 discovery 与全量 PV 列表确认只剩命名空间脚手架；实际存储回收由 resources 证明' : context.phase === 'namespace' ? '按原 UID 正常删除命名空间，并确认 API Server 原实例已消失' : context.phase === 'verify' ? '所有命名空间资源与关联 PV 的实际来源复盘归零' : '清理元数据由所属 owner 处理，cluster-control 不额外持有项目业务数据',
      count: physical ? context.confirmed.resources.length : 0 } };
  } };
}
