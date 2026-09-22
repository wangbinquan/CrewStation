import { ClusterFilterSchema, ClusterOperationQuerySchema } from '@crewstation/contracts';
import type { ClusterFilter, ClusterOperationQuery } from '@crewstation/contracts';
export type ClusterSearch = Partial<ClusterFilter> & { tab?: 'workloads' | 'pods' | 'network' | 'storage' | 'namespaces' | 'operations' | 'nodes' | 'history' | 'topology'; layer?: 'system' | 'projects' | 'project'; resourceId?: string; operationId?: string; operationUid?: string; operationPhase?: ClusterOperationQuery['phase'] };
export function parseClusterSearch(raw: Record<string, unknown>): ClusterSearch {
  const parsed = ClusterFilterSchema.safeParse(raw), query = parsed.success ? parsed.data : { scope: 'all' as const, limit: 50 };
  const tab = ['workloads', 'pods', 'network', 'storage', 'namespaces', 'operations', 'nodes', 'history', 'topology'].includes(String(raw.tab)) ? raw.tab as ClusterSearch['tab'] : 'workloads';
  const operations = ClusterOperationQuerySchema.safeParse({ uid: raw.operationUid, phase: raw.operationPhase });
  return { ...query, tab, ...(operations.success ? { operationUid: operations.data.uid, operationPhase: operations.data.phase } : {}), ...(typeof raw.resourceId === 'string' ? { resourceId: raw.resourceId } : {}), ...(raw.layer === 'system' || raw.layer === 'projects' || raw.layer === 'project' ? { layer: raw.layer } : {}), ...(typeof raw.operationId === 'string' ? { operationId: raw.operationId } : {}) };
}
export function clusterFilter(search: ClusterSearch): ClusterFilter { const { tab, resourceId: _resourceId, operationId: _operationId, layer: _layer, ...filters } = search; return ClusterFilterSchema.parse({ ...filters, view: ['operations', 'nodes', 'history', 'topology'].includes(tab ?? '') ? undefined : tab ?? 'workloads' }); }
export function changeClusterFilter(current: ClusterSearch, next: ClusterSearch): ClusterSearch { return { ...current, cursor: undefined, snapshotId: undefined, resourceId: undefined, ...next }; }
