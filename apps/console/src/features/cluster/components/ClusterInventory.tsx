// 「资源清单」面板（2026-09-23 裁定）：视图切换、筛选条、表格与详情都在这里；拓扑在另一个顶层页签。
// 宽屏整块长满到窗口底边：清单在左、详情在右，各自滚动；清单卡里只有表格区滚动，表头停在顶上，翻页钮在卡底（同日再裁定）。
import { useRef } from 'react';
import type { ReactElement } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { ClusterFilter, ClusterResource, ClusterSummary } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';
import { useHeldHeight } from '../../../shared/lib/useHeldHeight';
import { useT } from '../../../shared/lib/useT';
import { useViewportFill } from '../../../shared/lib/useViewportFill';
import { ActionRow } from '../../../shared/ui/ActionRow';
import { Button } from '../../../shared/ui/Button';
import { Card } from '../../../shared/ui/Card';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { Segmented } from '../../../shared/ui/Segmented';
import type { ClusterSearch, InventoryTab } from '../model/clusterSearch';
import { INVENTORY_TABS, LIST_TABS, isInventoryTab } from '../model/clusterSearch';
import { sameApartFromSnapshot, sameUsageScope } from '../model/clusterReads';
import { useExpiredSnapshotReset } from '../model/useExpiredSnapshotReset';
import { ClusterDetail } from './ClusterDetail';
import { ClusterFilters } from './ClusterFilters';
import { ClusterHistoryBrowser } from './ClusterHistory';
import { ClusterNodes } from './ClusterNodes';
import { ClusterOperations } from './ClusterOperations';
import { ClusterReclaimVolumes } from './ClusterReclaimVolumes';
import { ClusterStorage } from './ClusterStorage';
import { ClusterTable } from './ClusterTable';
import { UsageSummary } from './ClusterCapacity';
import styles from './Cluster.module.css';

interface Props {
  readonly search: ClusterSearch;
  readonly change: (patch: ClusterSearch) => void;
  readonly go: (next: ClusterSearch) => void;
  readonly summary?: ClusterSummary;
  readonly filter: ClusterFilter;
  readonly snapshotId?: string;
}

export function ClusterInventory({ search, change, go, summary, filter, snapshotId }: Props): ReactElement {
  const t = useT(), navigate = useNavigate(), queryClient = useQueryClient(), tab: InventoryTab = isInventoryTab(search.tab) ? search.tab : 'workloads', list = LIST_TABS.includes(tab);
  const resourceQuery = { ...filter, snapshotId };
  // 采集换快照只换读取目标：先留住当前页，等新快照的回执到达再原地替换，不整块卸载。
  const rows = useApiQuery(queryKeys.cluster('resources', resourceQuery), () => api.cluster.resources(resourceQuery), { enabled: !!snapshotId && list, keepPrevious: (previous) => sameApartFromSnapshot(previous, resourceQuery) });
  // 快照过期：回到最新快照的第一页，并立即重读摘要换到新快照（原「读取最新快照」按钮，2026-09-23 裁定去掉）。
  const expired = rows.error?.status === 410;
  useExpiredSnapshotReset(expired, () => { change({}); void queryClient.invalidateQueries({ queryKey: ['cluster', 'summary'] }); });
  const usageQuery = { resourceIds: rows.data?.items.filter((r) => r.kind === 'Pod' || r.kind === 'PersistentVolumeClaim').map((r) => r.resourceId) ?? [], scope: filter.scope, projectId: filter.projectId };
  const usage = useApiQuery(queryKeys.cluster('page-usage', usageQuery), () => api.cluster.usage(usageQuery), { enabled: !!rows.data && (tab === 'pods' || tab === 'storage'), refetchIntervalMs: 15_000, keepPrevious: (previous) => sameUsageScope(previous, usageQuery) });
  // 换视图或换筛选要重读，清单栏先撑住上一次的高度，窄屏时页签条与列表不被顶出视口（宽屏清单栏定高，撑住也不越界）。
  const [panel, panelStyle] = useHeldHeight<HTMLDivElement>(`${tab}|${JSON.stringify(filter)}`);
  const host = useRef<HTMLDivElement>(null);
  useViewportFill(host);
  const select = (row: ClusterResource) => go({ ...search, resourceId: row.resourceId });
  return <div ref={host} className={styles.inventory}>
    <Segmented label={t('cluster.inventory')} value={tab} onChange={(value) => change({ tab: value as InventoryTab, kind: undefined, purpose: undefined, status: undefined })} items={INVENTORY_TABS.map((value) => ({ value, label: t(`cluster.tab.${value}`) }))} />
    {tab !== 'nodes' && tab !== 'reclaim' ? <Card compact title={t('cluster.filters')}><ClusterFilters search={search} summary={summary} change={change} /></Card> : null}
    <div className={search.resourceId ? `${styles.split} ${styles.hasDetail}` : styles.split}>
      <div ref={panel} style={panelStyle} className={styles.list}>
        {tab === 'nodes' ? <ClusterNodes selectPod={(resourceId) => go({ ...search, resourceId })} /> : tab === 'history' ? <ClusterHistoryBrowser key={filter.projectId ?? 'all'} projectId={filter.projectId} /> : tab === 'operations' ? <ClusterOperations search={search} change={change} /> : tab === 'reclaim' ? <ClusterReclaimVolumes projects={summary?.projects ?? []} /> : <Card className={styles.listCard} title={t('cluster.resourceCount', { count: rows.data?.total === 0 && !rows.data.complete ? '—' : rows.data?.total ?? '—' })} compact stacked>
          <QueryStatus isPending={rows.isPending || expired} error={expired ? null : rows.error} isEmpty={rows.data?.complete === true && rows.data.total === 0} emptyTitle={t('cluster.empty')} />
          {tab === 'pods' || tab === 'storage' ? <><QueryStatus isPending={usage.isPending} error={usage.error} />{usage.data ? <UsageSummary title={t('cluster.metrics.selectedScope')} data={usage.data.summary} /> : null}</> : null}
          {rows.data ? <div className={styles.rows}>{tab === 'storage' ? <ClusterStorage rows={rows.data.items} usages={usage.data?.items ?? []} select={select} stickyHeader /> : <ClusterTable rows={rows.data.items} usages={usage.data?.items} select={select} stickyHeader />}</div> : null}
          <ActionRow>{search.cursor ? <Button onClick={() => change({})}>{t('cluster.firstPage')}</Button> : null}{rows.data?.nextCursor ? <Button onClick={() => go({ ...search, cursor: rows.data!.nextCursor, snapshotId: rows.data!.snapshotId, resourceId: undefined })}>{t('cluster.nextPage')}</Button> : null}</ActionRow>
        </Card>}
      </div>
      {/* 详情栏自己滚：换一个资源换一个栏，新详情从顶上看起。 */}
      {search.resourceId ? <div key={search.resourceId} className={styles.aside}><ClusterDetail key={search.resourceId} resourceId={search.resourceId} snapshotId={snapshotId} close={() => { void navigate({ to: '/admin/cluster', search: { ...search, resourceId: undefined }, resetScroll: false }).then(() => document.querySelector<HTMLButtonElement>(`[data-cluster-resource="${search.resourceId}"]`)?.focus()); }} select={select} onOperation={(id) => go({ ...search, operationId: id })} /></div> : null}
    </div>
  </div>;
}
