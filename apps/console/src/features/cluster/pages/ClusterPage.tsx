import { useEffect, useRef } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { Stack } from '../../../shared/ui/Stack';
import { Tabs } from '../../../shared/ui/Tabs';
import { ClusterInventory } from '../components/ClusterInventory';
import { ClusterTopology } from '../components/ClusterTopology';
import type { ClusterSearch, InventoryTab } from '../model/clusterSearch';
import { changeClusterFilter, clusterFilter, isInventoryTab, parseClusterSearch } from '../model/clusterSearch';
import { useExpiredSnapshotReset } from '../model/useExpiredSnapshotReset';

/**
 * 集群管理（2026-09-23 裁定的结构）：只有「拓扑｜资源清单」两个顶层页签，缺省拓扑；指标条同日再裁定挪到管理总览最上面。
 * 宽屏两个页签都长满一屏、各栏各自滚动，整页不出纵向滚动条。清单类型、筛选条、表格与详情都在「资源清单」里。
 * URL 的 tab 参数沿用旧值，深链接不变。
 */
export function ClusterPage() {
  const t = useT(), navigate = useNavigate(), search = parseClusterSearch(useSearch({ strict: false })), filter = clusterFilter(search);
  const go = (next: ClusterSearch) => { void navigate({ to: '/admin/cluster', search: next, resetScroll: false }); };
  const change = (patch: ClusterSearch) => go(changeClusterFilter(search, patch));
  const summary = useApiQuery(queryKeys.cluster('summary', filter), () => api.cluster.summary(filter), { refetchIntervalMs: 15_000, refetchOnWindowFocus: true });
  const snapshotId = search.snapshotId ?? summary.data?.snapshotId;
  // 不再有「请求刷新」：后台每 30 秒采集一次，摘要每 15 秒重读；URL 里固定的快照过期就自动回到最新快照的第一页（2026-09-23 裁定）。
  const expired = summary.error?.status === 410;
  useExpiredSnapshotReset(expired, () => change({}));
  // 从拓扑切回清单时回到上次看的那类清单；首次进清单从工作负载开始。
  const lastInventory = useRef<InventoryTab>('workloads');
  useEffect(() => { if (isInventoryTab(search.tab)) lastInventory.current = search.tab; }, [search.tab]);
  const section = isInventoryTab(search.tab) ? 'inventory' : 'topology';
  // 摘要是两个页签的底数（快照、项目名单、资源类型）；读取失败写在页签上方，载入中由各页签自己显示。
  return <><PageHeader title={t('cluster.title')} description={t('cluster.description')} />
    <Stack>
      {summary.error && !expired ? <QueryStatus isPending={false} error={summary.error} /> : null}
      <Tabs label={t('cluster.views')} value={section} onChange={(value) => change(value === 'topology' ? { tab: 'topology' } : { tab: lastInventory.current, kind: undefined, purpose: undefined, status: undefined })} items={[{ value: 'topology', label: t('cluster.tab.topology') }, { value: 'inventory', label: t('cluster.inventory') }]}>
        {section === 'topology' ? <ClusterTopology search={search} change={change} go={go} summary={summary.data} snapshotId={snapshotId} /> : <ClusterInventory search={search} change={change} go={go} summary={summary.data} filter={filter} snapshotId={snapshotId} />}
      </Tabs>
    </Stack>
  </>;
}
