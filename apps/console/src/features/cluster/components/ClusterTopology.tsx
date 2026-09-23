// 集群管理「拓扑」页签（RFC-019）：系统层 → 项目层 → Pod 层；Pod 层与系统层的详情复用 RFC-010 的资源详情。
import { useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import type { ClusterResource, ClusterSummary } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { buildProjectTopology } from '../../../shared/topology/projectTopology';
import { buildProjectsLayer, columnsFor, MORE_NODE_ID } from '../../../shared/topology/projectsLayer';
import { buildSystemTopology } from '../../../shared/topology/systemTopology';
import { Button } from '../../../shared/ui/Button';
import { Card } from '../../../shared/ui/Card';
import { DefinitionList } from '../../../shared/ui/DefinitionList';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { Segmented } from '../../../shared/ui/Segmented';
import { SUMMARY_METRICS } from '../../../shared/ui/topology/topologyLayout';
import { TopologyWorkspace } from '../../../shared/ui/topology/TopologyWorkspace';
import { useContainerWidth } from '../../../shared/ui/topology/useContainerWidth';
import type { ClusterSearch } from '../model/clusterSearch';
import { sameApartFromSnapshot } from '../model/clusterReads';
import { ClusterDetail } from './ClusterDetail';
import styles from './Cluster.module.css';

type Layer = NonNullable<ClusterSearch['layer']>;
interface Props { readonly search: ClusterSearch; readonly change: (patch: ClusterSearch) => void; readonly go: (next: ClusterSearch) => void; readonly summary?: ClusterSummary; readonly snapshotId?: string }

/** 单个项目的资源可能超过一页（100）：顺着游标最多读 5 页，再多就标不完整。 */
async function readProjectResources(projectId: string, snapshotId: string): Promise<{ items: ClusterResource[]; complete: boolean; snapshotId: string }> {
  const items: ClusterResource[] = []; let cursor: string | undefined, complete = true;
  for (let page = 0; page < 5; page += 1) {
    const result = await api.cluster.resources({ scope: 'project', projectId, limit: 100, snapshotId, cursor });
    items.push(...result.items); complete = complete && result.complete;
    if (!result.nextCursor) return { items, complete, snapshotId: result.snapshotId };
    cursor = result.nextCursor;
  }
  return { items, complete: false, snapshotId };
}

export function ClusterTopology({ search, change, go, summary, snapshotId }: Props): ReactElement {
  const t = useT(), layer: Layer = search.layer ?? 'system', projectId = layer === 'project' ? search.projectId : undefined;
  // 选中随层级作用域：换层或换项目后旧选中自然失效，不需要在 effect 里清空。
  const scope = `${layer}:${projectId ?? ''}`;
  const [selection, setSelection] = useState<{ scope: string; id?: string }>(), [expanded, setExpanded] = useState(false);
  const selected = selection?.scope === scope ? selection.id : undefined, setSelected = (id: string | undefined) => setSelection({ scope, id });
  const [main, width] = useContainerWidth<HTMLDivElement>();
  const snapshot = useMemo(() => ({ id: snapshotId ?? '', observedAt: summary?.finishedAt ?? '', complete: summary?.complete ?? false, incompleteReason: summary && !summary.complete ? summary.sources.filter((s) => s.state === 'error' || s.state === 'stale').map((s) => `${s.kind}${s.reason ? `（${s.reason}）` : ''}`).join('、') : undefined }), [snapshotId, summary]);
  const systemQuery = { scope: 'system' as const, view: 'workloads' as const, limit: 100, snapshotId };
  const system = useApiQuery(queryKeys.cluster('topology-system', systemQuery), () => api.cluster.resources(systemQuery), { enabled: layer === 'system' && !!snapshotId, keepPrevious: (previous) => sameApartFromSnapshot(previous, systemQuery) });
  const projectQuery = { projectId, snapshotId };
  const projectResources = useApiQuery(queryKeys.cluster('topology-project', projectQuery), () => readProjectResources(projectId!, snapshotId!), { enabled: layer === 'project' && !!projectId && !!snapshotId, keepPrevious: (previous) => sameApartFromSnapshot(previous, projectQuery) });
  const project = useApiQuery(queryKeys.project(projectId ?? ''), () => api.projects.get(projectId!), { enabled: layer === 'project' && !!projectId });
  const serviceId = project.data?.serviceId;
  const slots = useApiQuery(queryKeys.slots(serviceId ?? ''), () => api.services.listSlots(serviceId!), { enabled: layer === 'project' && !!serviceId });
  const devSession = useApiQuery(queryKeys.devSession(projectId ?? ''), () => api.devSession.get(projectId!), { enabled: layer === 'project' && !!projectId });
  const dataResources = useApiQuery(queryKeys.dataResources(projectId ?? ''), () => api.tasks.listDataResources(projectId!), { enabled: layer === 'project' && !!projectId });
  const topology = useMemo(() => {
    if (!summary) return undefined;
    if (layer === 'system') return system.data ? buildSystemTopology({ resources: system.data.items, summary, snapshot }, t) : undefined;
    if (layer === 'projects') return buildProjectsLayer({ projects: summary.projects, columns: columnsFor(width), expanded, snapshot }, t);
    if (!project.data || !projectResources.data) return undefined;
    return buildProjectTopology({ project: { id: project.data.id, name: project.data.name, kind: project.data.kind, namespace: project.data.namespace }, resources: projectResources.data.items, slots: slots.data?.items ?? [], devSession: devSession.data && !devSession.error ? devSession.data : undefined, dataResources: dataResources.data?.items ?? [], snapshot: { ...snapshot, complete: snapshot.complete && projectResources.data.complete } }, t);
  }, [layer, summary, snapshot, system.data, projectResources.data, project.data, slots.data, devSession.data, devSession.error, dataResources.data, width, expanded, t]);
  const projectName = (id: string | undefined): string | undefined => summary?.projects.find((p) => p.id === id)?.name;
  const select = (id: string | undefined) => { if (id === MORE_NODE_ID) { setExpanded(true); return; } setSelected(id); };
  const openProject = (id: string) => change({ layer: 'project', projectId: id, scope: 'project' });
  const node = topology?.nodes.find((n) => n.id === selected);
  const error = system.error ?? projectResources.error ?? project.error ?? slots.error ?? dataResources.error ?? (devSession.error && devSession.error.status !== 404 ? devSession.error : null);
  const detail = node ? (node.resourceId ? <ClusterDetail key={node.resourceId} resourceId={node.resourceId} snapshotId={snapshotId} close={() => setSelected(undefined)} onOperation={(id) => go({ ...search, operationId: id })}
      select={(row) => { const target = topology?.nodes.find((n) => n.resourceId === row.resourceId); if (target) setSelected(target.id); else go({ ...search, tab: 'pods', resourceId: row.resourceId }); }} />
    : <Card title={node.title} extra={<Button variant="ghost" onClick={() => setSelected(undefined)}>{t('cluster.close')}</Button>} stacked>
      {/* 侧栏详情的操作一律在顶部（2026-09-23 作者裁定，RFC-019 修订说明），不套用对象卡的底部操作条。 */}
      {node.id.startsWith('project:') ? <div className={styles.actions}><Button variant="primary" onClick={() => openProject(node.id.slice('project:'.length))}>{t('cluster.topology.expand')}</Button></div> : null}
      <DefinitionList items={(node.facts ?? []).map(([label, value]) => ({ label, value }))} />
    </Card>) : undefined;
  return <div ref={main} className={styles.stack}>
    <Segmented label={t('cluster.topology.layers')} value={layer} onChange={(value) => { if (value === 'system') change({ layer: 'system' }); else if (value === 'projects') change({ layer: 'projects' }); else if (projectId) change({ layer: 'project', projectId }); }}
      items={[{ value: 'system', label: t('cluster.topology.system') }, { value: 'projects', label: t('cluster.topology.projects', { count: summary?.projects.length ?? '—' }) }, { value: 'project', label: projectId ? t('cluster.topology.project', { name: projectName(projectId) ?? projectId }) : t('cluster.topology.projectNone'), disabled: !projectId }]}
      extra={layer === 'project' && projectId ? <>{t('cluster.topology.breadcrumb', { name: projectName(projectId) ?? projectId })} <Button variant="ghost" onClick={() => change({ layer: 'projects', projectId: undefined, scope: 'all' })}>{t('cluster.topology.back')}</Button></> : undefined} />
    <QueryStatus isPending={!error && !topology && (layer !== 'projects' || !summary)} error={error} isEmpty={topology !== undefined && topology.nodes.length === 0} emptyTitle={t('cluster.empty')} />
    {topology && topology.nodes.length > 0 ? <TopologyWorkspace key={topology.id} topology={topology} label={topology.title} selectedId={selected} onSelect={select} metrics={layer === 'projects' ? SUMMARY_METRICS : undefined} filters={layer !== 'projects'} legend={layer !== 'projects'} detail={detail} /> : null}
  </div>;
}
