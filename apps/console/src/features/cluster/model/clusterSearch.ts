import { ClusterFilterSchema, ClusterOperationQuerySchema } from '@crewstation/contracts';
import type { ClusterFilter, ClusterOperationQuery } from '@crewstation/contracts';
export type ClusterSearch = Partial<ClusterFilter> & { tab?: 'workloads' | 'pods' | 'network' | 'storage' | 'namespaces' | 'operations'; resourceId?: string; operationId?: string; operationUid?: string; operationPhase?: ClusterOperationQuery['phase'] };
export function parseClusterSearch(raw: Record<string, unknown>): ClusterSearch {
  const parsed = ClusterFilterSchema.safeParse(raw), query = parsed.success ? parsed.data : { scope: 'all' as const, limit: 50 };
  const tab = ['workloads', 'pods', 'network', 'storage', 'namespaces', 'operations'].includes(String(raw.tab)) ? raw.tab as ClusterSearch['tab'] : 'workloads';
  const operations = ClusterOperationQuerySchema.safeParse({ uid: raw.operationUid, phase: raw.operationPhase });
  return { ...query, tab, ...(operations.success ? { operationUid: operations.data.uid, operationPhase: operations.data.phase } : {}), ...(typeof raw.resourceId === 'string' ? { resourceId: raw.resourceId } : {}), ...(typeof raw.operationId === 'string' ? { operationId: raw.operationId } : {}) };
}
export function clusterFilter(search: ClusterSearch): ClusterFilter { const { tab, resourceId: _resourceId, operationId: _operationId, ...filters } = search; return ClusterFilterSchema.parse({ ...filters, view: tab === 'operations' ? undefined : tab ?? 'workloads' }); }
export function changeClusterFilter(current: ClusterSearch, next: ClusterSearch): ClusterSearch { return { ...current, cursor: undefined, snapshotId: undefined, resourceId: undefined, ...next }; }
