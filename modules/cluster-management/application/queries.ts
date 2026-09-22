import type { Actor, ClusterFilter, ClusterProjectCounts, ClusterResource, ClusterSummary, ProjectClusterResources } from '@crewstation/contracts';
import { conflict, forbidden, notFound, PlatformError, validation } from '@crewstation/kernel';
import type { InventorySnapshot } from '../domain/inventory';
import { digest } from '../domain/projection';
import type { ClusterDeps } from './dependencies';
export async function requireAdmin(deps: ClusterDeps, actor: Actor): Promise<void> { if (!actor.isAdmin || !await deps.isAdmin(actor.userId)) throw forbidden('集群管理仅限平台管理员'); }
export function completeSnapshot(snapshot: InventorySnapshot): boolean { return snapshot.facts.complete && snapshot.sources.every((s) => s.state === 'complete' || s.state === 'unsupported'); }
export async function readSnapshot(deps: ClusterDeps, id?: string): Promise<InventorySnapshot> {
  const snapshot = id ? await deps.repository.snapshot(id) : await deps.repository.latest();
  if (!snapshot) { if (!id) await deps.repository.requestRefresh(); throw new PlatformError(id ? 'not_found' : 'unavailable', id ? '快照已过期，请刷新列表' : '首次采集中，请稍后刷新', id ? { status: 410 } : {}); }
  if (id && deps.clock.now().getTime() - Date.parse(snapshot.finishedAt) > 600_000) throw new PlatformError('not_found', '快照已过期，请刷新列表', { status: 410 });
  return snapshot;
}
export const matches = (r: ClusterResource, q: ClusterFilter): boolean =>
  (q.scope === 'all' || r.ownership.scope === q.scope) && (!q.projectId || r.ownership.scope === 'project' && r.ownership.projectId === q.projectId) && (!q.namespace || r.namespace === q.namespace) && (!q.kind || r.kind === q.kind) && (!q.purpose || r.purpose === q.purpose) && (!q.view || r.view === q.view && (q.view !== 'workloads' || r.topLevel)) && (!q.status || (q.status === 'abnormal' ? r.abnormal : q.status === 'ready' ? r.ready : q.status === 'terminating' ? !!r.deletingAt : r.phase === q.status)) && (!q.q || `${r.name} ${r.namespace} ${r.kind} ${r.reason} ${r.ownership.scope === 'project' ? r.ownership.projectName : ''}`.toLowerCase().includes(q.q.toLowerCase()));

export function snapshotSummary(s: InventorySnapshot, q: ClusterFilter): ClusterSummary {
  const rows = s.resources.filter((r) => matches(r, { ...q, view: undefined, kind: undefined, status: undefined, purpose: undefined })), count = (fn: (r: ClusterResource) => boolean) => rows.filter(fn).length;
  const distribution = (key: 'kind' | 'phase' | 'purpose') => rows.reduce<Record<string, number>>((acc, row) => ({ ...acc, [row[key]]: (acc[row[key]] ?? 0) + 1 }), {});
  return { snapshotId: s.id, startedAt: s.startedAt, finishedAt: s.finishedAt, complete: completeSnapshot(s), sources: s.sources, total: rows.length, workloads: count((r) => r.view === 'workloads' && r.topLevel), pods: count((r) => r.kind === 'Pod'), runningPods: count((r) => r.kind === 'Pod' && r.phase === 'Running'), readyPods: count((r) => r.kind === 'Pod' && r.ready), standalonePods: count((r) => r.standalone), services: count((r) => r.kind === 'Service'), pvcs: count((r) => r.kind === 'PersistentVolumeClaim'), abnormal: count((r) => r.kind === 'Pod' && r.abnormal), kinds: distribution('kind'), phases: distribution('phase'), purposes: distribution('purpose'), projects: projectCounts(s) };
}
/** 每项目计数（RFC-019 项目层）：只在快照完整时给数字，来源失败时整组缺席而不是 0。 */
export function projectCounts(s: InventorySnapshot): ClusterProjectCounts[] {
  const complete = completeSnapshot(s);
  return s.facts.projects.map((p) => {
    const rows = s.resources.filter((r) => r.ownership.scope === 'project' && r.ownership.projectId === p.projectId), count = (fn: (r: ClusterResource) => boolean) => rows.filter(fn).length;
    return { id: p.projectId, name: p.name, ...(complete ? { workloads: count((r) => r.view === 'workloads' && r.topLevel), pods: count((r) => r.kind === 'Pod'), readyPods: count((r) => r.kind === 'Pod' && r.ready), abnormal: count((r) => r.kind === 'Pod' && r.abnormal), devSessions: count((r) => r.kind === 'Pod' && r.purpose === 'development-workspace') } : {}) };
  });
}
const PROJECT_RESOURCE_LIMIT = 500;
const kindRank = (r: ClusterResource): number => (r.kind === 'Pod' ? 0 : r.view === 'workloads' ? 1 : r.kind === 'PersistentVolumeClaim' ? 2 : r.kind === 'Service' ? 3 : 4);
/** 项目成员的只读盘点：同一份快照按项目过滤，Pod 与工作负载优先保留，管理动作一律清空。 */
export function projectResourcesIn(s: InventorySnapshot, projectId: string): ProjectClusterResources {
  const rows = s.resources.filter((r) => r.ownership.scope === 'project' && r.ownership.projectId === projectId).sort((a, b) => kindRank(a) - kindRank(b) || `${a.kind}/${a.name}/${a.uid}`.localeCompare(`${b.kind}/${b.name}/${b.uid}`));
  return { snapshotId: s.id, observedAt: s.finishedAt, complete: completeSnapshot(s), sources: s.sources, items: rows.slice(0, PROJECT_RESOURCE_LIMIT).map((r) => ({ ...r, availableActions: [] })), truncated: rows.length > PROJECT_RESOURCE_LIMIT };
}
export async function projectResources(deps: ClusterDeps, actor: Actor, projectId: string, snapshotId?: string): Promise<ProjectClusterResources> {
  await deps.authorizeProject(actor, projectId);
  return projectResourcesIn(await readSnapshot(deps, snapshotId), projectId);
}
export function pageResources(s: InventorySnapshot, q: ClusterFilter) {
  const { cursor, snapshotId: _snapshotId, limit, ...filters } = q, fingerprint = digest(filters);
  const rows = s.resources.filter((r) => matches(r, q)).sort((a, b) => `${a.namespace}/${a.name}/${a.uid}`.localeCompare(`${b.namespace}/${b.name}/${b.uid}`));
  let offset = 0;
  if (cursor) {
    let decoded; try { decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as { snapshotId: string; fingerprint: string; offset: number }; } catch { throw validation('列表游标无效'); }
    if (decoded.snapshotId !== s.id || decoded.fingerprint !== fingerprint) throw conflict('游标与当前快照或筛选不匹配');
    offset = decoded.offset; if (!Number.isSafeInteger(offset) || offset < 0) throw validation('列表位置无效');
  }
  return { snapshotId: s.id, complete: completeSnapshot(s), items: rows.slice(offset, offset + limit), total: rows.length, ...(offset + limit < rows.length ? { nextCursor: Buffer.from(JSON.stringify({ snapshotId: s.id, fingerprint, offset: offset + limit })).toString('base64url') } : {}) };
}
export function resourceIn(s: InventorySnapshot, id: string): ClusterResource { const row = s.resources.find((r) => r.resourceId === id); if (!row) throw notFound('受管资源', id); return row; }
export function relatedResources(s: InventorySnapshot, r: ClusterResource): ClusterResource[] {
  const related = new Set([r.uid]), key = `${r.namespace}/${r.kind}/${r.name}`;
  for (let pass = 0; pass < 8; pass++) for (const row of s.resources) if (row.owners.some((o) => related.has(o.uid))) related.add(row.uid);
  return s.resources.filter((row) => row.uid !== r.uid && (related.has(row.uid) || r.owners.some((o) => o.uid === row.uid) || r.references.includes(`${row.namespace}/${row.kind}/${row.name}`) || row.references.includes(key)));
}
