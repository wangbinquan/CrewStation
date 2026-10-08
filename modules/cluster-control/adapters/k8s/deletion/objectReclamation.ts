import type { ProjectDeletionContext } from '@crewstation/contracts';
import type { K8sClient } from '@crewstation/k8s';
import { Resources } from '@crewstation/k8s';
import { conflict, precondition } from '@crewstation/kernel';
import { originalUid } from '../../../domain/deletion/objects';
import type { ClusterDeletionAdmission } from '../../../api/projectDeletion';
import type { LedgerObservations } from '../../../ports/ledger';

/** 卷和工作负载由其物理 owner 证明；这里只回收原确认的网关实体与凭据。 */
export async function reclaimProjectObjects(k8s: K8sClient, ledger: Pick<LedgerObservations, 'claimOf' | 'get'>, admission: ClusterDeletionAdmission, context: ProjectDeletionContext): Promise<void> {
  if (context.confirmed.participant !== 'cluster-control' || !['purge', 'prove'].includes(context.phase)) throw precondition('原集群对象回收的许可来源或阶段不符');
  const signal = AbortSignal.timeout(30_000);
  for (const entry of context.confirmed.resources.filter(row => ['IngressRoute', 'Middleware', 'Secret'].includes(row.kind))) {
    const identity = JSON.parse(entry.id) as { apiVersion?: string; kind?: string; namespace?: string; name?: string }, ref = Resources[entry.kind];
    if (!ref?.namespaced || identity.apiVersion !== ref.apiVersion || identity.kind !== ref.kind || identity.namespace !== context.target.namespace || !identity.name) throw precondition('原集群对象的完整来源不符');
    await admission.assertSealed(context); await admission.assertGrant(context); signal.throwIfAborted();
    const current = await k8s.get(ref, identity.name, identity.namespace, signal);
    if (!current) continue;
    const uid = originalUid(entry);
    if (current.metadata.uid !== uid) throw conflict('原集群对象已被同名新实例替换，停止清理');
    const recordId = await ledger.claimOf({ kind: ref.kind, namespace: identity.namespace, name: identity.name, uid });
    const record = recordId && await ledger.get(recordId);
    if (!record || record.projectId !== context.target.id || !record.children.some(child => child.kind === ref.kind && child.namespace === identity.namespace && child.name === identity.name && child.uid === uid)) throw precondition('原集群对象的公开台账归属已改变，停止清理');
    if (current.metadata.deletionTimestamp) continue;
    await admission.assertSealed(context); await admission.assertGrant(context); signal.throwIfAborted();
    await k8s.delete(ref, identity.name, identity.namespace, { preconditions: { uid, ...(current.metadata.resourceVersion ? { resourceVersion: current.metadata.resourceVersion } : {}) } });
  }
}
