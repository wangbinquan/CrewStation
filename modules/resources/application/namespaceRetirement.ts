import { conflict, notFound, precondition } from '@crewstation/kernel';
import type { LedgerRecord } from '../domain/record';
import type { LedgerScope } from '../ports/repositories';
import { commitRecord } from './commit';

export interface RetirementChild { readonly kind: string; readonly namespace?: string; readonly name: string; readonly uid: string }
/** 本操作只收尾命名空间内已结束的附属设施；PVC 和未结束的领域记录必须先单独处理。 */
export async function retireNamespaceIn(scope: LedgerScope, id: string, uid: string, inspect: (name: string, children: readonly RetirementChild[]) => Promise<void>, now: Date): Promise<void> {
  const original = await scope.records.get(id);
  if (!original || original.kind !== 'namespace' || original.owner.module !== 'provisioning' || !original.projectId) throw notFound('项目命名空间记录', id);
  await scope.locks.lock(original.projectId);
  const namespace = await scope.records.get(id, { forUpdate: true });
  if (!namespace || namespace.desired === 'absent') return;
  const name = namespace.spec.children.find((child) => child.kind === 'Namespace')?.name;
  if (!name || namespace.children.find((child) => child.kind === 'Namespace')?.uid !== uid) throw conflict('命名空间实例已变化，请刷新后重新检查');
  const records = await scope.records.list({ projectId: namespace.projectId!, includeStopped: true });
  if (records.length >= 2000) throw precondition('项目资源达到查询上限，停止不完整清理');
  const affected = records.filter((record) => record.id === id || [...record.spec.children, ...record.children].some((child) => child.namespace === name));
  const blocker = affected.find((record) => record.id !== id && record.kind !== 'network-policy-set' && (record.kind === 'volume' ? record.desired !== 'absent' || record.phase !== 'stopped' : record.phase !== 'stopped'));
  if (blocker) throw precondition(`请先处理资源 ${blocker.kind}（${blocker.id}），当前阶段 ${blocker.phase}`);
  const holder = `namespace-retirement/${crypto.randomUUID()}`, leases: string[] = [];
  try {
    for (const lease of [...new Set([...affected.map((record) => record.id), 'route-arbitration'])].sort()) {
      if (!await scope.leases.acquire(lease, holder, 30_000)) throw conflict('项目资源正在调和，请稍后重试删除');
      leases.push(lease);
    }
    const children = affected.flatMap((record) => record.children.filter((child): child is typeof child & { uid: string } => !!child.uid && child.namespace === name && ['Service', 'ResourceQuota', 'NetworkPolicy'].includes(child.kind)).map(({ kind, namespace: ns, name: childName, uid: childUid }) => ({ kind, namespace: ns, name: childName, uid: childUid })));
    await inspect(name, children);
    for (const record of affected) {
      const current = await scope.records.get(record.id, { forUpdate: true });
      if (!current || current.desired === 'absent') continue;
      const next: LedgerRecord = { ...current, desired: 'absent', generation: current.generation + 1, releaseReason: { code: 'archived-namespace-deleted', message: '管理员确认删除归档项目的命名空间' },
        ...(record.id === id ? { spec: { ...current.spec, retirement: { uid, children } } } : {}) };
      await commitRecord(scope, current, next, now);
    }
  } finally { for (const lease of leases.reverse()) await scope.leases.release(lease, holder); }
}

/** 删除意图一旦持久化，同项目的新集群对象声明不能再次复活命名空间。 */
export async function guardNamespaceRetirement(scope: LedgerScope, input: { projectId?: LedgerRecord['projectId']; kind: string; spec: LedgerRecord['spec'] }): Promise<void> {
  if (!input.projectId || (!input.spec.children.some((child) => child.namespace) && input.kind !== 'namespace')) return;
  await scope.locks.lock(input.projectId);
  const namespace = await scope.records.getByOwner({ module: 'provisioning', ref: input.projectId }, 'namespace');
  if (namespace?.releaseReason?.code === 'archived-namespace-deleted') throw conflict('项目命名空间已受理删除，不能重新声明其中的资源');
}
