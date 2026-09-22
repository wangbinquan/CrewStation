import { ClusterFilterSchema, ClusterOperationQuerySchema } from '@crewstation/contracts';
import type { ClusterFilter, ClusterOperationQuery } from '@crewstation/contracts';

/** 「资源清单」里的视图，按 2026-09-23 裁定的顺序：五类清单在前，节点、趋势、操作记录在后。 */
export const INVENTORY_TABS = ['workloads', 'pods', 'network', 'storage', 'namespaces', 'nodes', 'history', 'operations'] as const;
export type InventoryTab = (typeof INVENTORY_TABS)[number];
/** 走资源清单接口（`/resources`）的视图；节点、趋势、操作记录各自取数。 */
export const LIST_TABS: readonly InventoryTab[] = ['workloads', 'pods', 'network', 'storage', 'namespaces'];
const TABS: readonly string[] = ['topology', ...INVENTORY_TABS];

export type ClusterSearch = Partial<ClusterFilter> & { tab?: 'topology' | InventoryTab; layer?: 'system' | 'projects' | 'project'; resourceId?: string; operationId?: string; operationUid?: string; operationPhase?: ClusterOperationQuery['phase'] };
export const isInventoryTab = (tab: ClusterSearch['tab']): tab is InventoryTab => tab !== undefined && tab !== 'topology';

export function parseClusterSearch(raw: Record<string, unknown>): ClusterSearch {
  const parsed = ClusterFilterSchema.safeParse(raw), query = parsed.success ? parsed.data : { scope: 'all' as const, limit: 50 };
  // 缺省即拓扑（2026-09-23 裁定）；只带 resourceId 的旧链接仍落在清单里，详情在那里渲染。
  const tab = TABS.includes(String(raw.tab)) ? raw.tab as ClusterSearch['tab'] : typeof raw.resourceId === 'string' ? 'workloads' : 'topology';
  const operations = ClusterOperationQuerySchema.safeParse({ uid: raw.operationUid, phase: raw.operationPhase });
  return { ...query, tab, ...(operations.success ? { operationUid: operations.data.uid, operationPhase: operations.data.phase } : {}), ...(typeof raw.resourceId === 'string' ? { resourceId: raw.resourceId } : {}), ...(raw.layer === 'system' || raw.layer === 'projects' || raw.layer === 'project' ? { layer: raw.layer } : {}), ...(typeof raw.operationId === 'string' ? { operationId: raw.operationId } : {}) };
}
export function clusterFilter(search: ClusterSearch): ClusterFilter { const { tab, resourceId: _resourceId, operationId: _operationId, layer: _layer, ...filters } = search; return ClusterFilterSchema.parse({ ...filters, view: tab !== undefined && (LIST_TABS as readonly string[]).includes(tab) ? tab : undefined }); }
export function changeClusterFilter(current: ClusterSearch, next: ClusterSearch): ClusterSearch { return { ...current, cursor: undefined, snapshotId: undefined, resourceId: undefined, ...next }; }
