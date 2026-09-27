import type { ClusterWriter } from '../ports/cluster';
import type { LedgerObservations } from '../ports/ledger';
import type { LedgerRecordView } from '../ports/ledger';
import type { NamespaceRetirement } from '../domain/namespaceRetirement';

/** 只有明确持久化的管理员意图才能删除命名空间；旧的 absent 记录也不能触发级联删除。 */
export async function retireNamespace(deps: { cluster: ClusterWriter; ledger: LedgerObservations; systemNamespace: string; signal?: AbortSignal }, record: LedgerRecordView): Promise<void> {
  const raw = record.spec['retirement'] as Partial<NamespaceRetirement> | undefined;
  const name = record.spec.children.find((child) => child.kind === 'Namespace')?.name;
  if (!raw || typeof raw.uid !== 'string' || !raw.uid || !Array.isArray(raw.children) || raw.children.some((child) => !child || typeof child.kind !== 'string' || typeof child.name !== 'string' || typeof child.uid !== 'string' || child.namespace !== name) || !name || !deps.cluster.removeRetiredNamespace) throw new Error('缺少管理员命名空间删除意图或完整检查能力');
  try {
    deps.signal?.throwIfAborted();
    await deps.cluster.removeRetiredNamespace(name, { uid: raw.uid, children: raw.children }, deps.systemNamespace, deps.signal);
    await deps.ledger.observeConditions(record.id, [{ type: 'CleanupBlocked', status: 'false' }]);
  } catch (error) {
    await deps.ledger.observeConditions(record.id, [{ type: 'CleanupBlocked', status: 'true', reason: 'namespace-cleanup-blocked', message: (error instanceof Error ? error.message : String(error)).slice(0, 2000) }]);
    throw error;
  }
}
