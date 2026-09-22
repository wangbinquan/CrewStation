import { useEffect, useRef } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { Stack } from '../../../shared/ui/Stack';
import { Tabs } from '../../../shared/ui/Tabs';
import { ClusterInventory } from '../components/ClusterInventory';
import { ClusterOverviewStrip } from '../components/ClusterOverviewStrip';
import { ClusterTopology } from '../components/ClusterTopology';
import type { ClusterSearch, InventoryTab } from '../model/clusterSearch';
import { changeClusterFilter, clusterFilter, isInventoryTab, parseClusterSearch } from '../model/clusterSearch';

/**
 * 集群管理（2026-09-23 裁定的结构）：顶部一条指标条，其下「拓扑｜资源清单」两个顶层页签，缺省拓扑；
 * 清单类型、筛选条、表格与详情都在「资源清单」里。URL 的 tab 参数沿用旧值，深链接不变。
 */
export function ClusterPage() {
  const t = useT(), navigate = useNavigate(), search = parseClusterSearch(useSearch({ strict: false })), filter = clusterFilter(search);
  const go = (next: ClusterSearch) => { void navigate({ to: '/admin/cluster', search: next, resetScroll: false }); };
  const change = (patch: ClusterSearch) => go(changeClusterFilter(search, patch));
  const summary = useApiQuery(queryKeys.cluster('summary', filter), () => api.cluster.summary(filter), { refetchIntervalMs: 15_000, refetchOnWindowFocus: true });
  const snapshotId = search.snapshotId ?? summary.data?.snapshotId;
  const refresh = useApiMutation(() => api.cluster.refresh(), { invalidate: [['cluster']], onSuccess: () => change({}) });
  // 从拓扑切回清单时回到上次看的那类清单；首次进清单从工作负载开始。
  const lastInventory = useRef<InventoryTab>('workloads');
  useEffect(() => { if (isInventoryTab(search.tab)) lastInventory.current = search.tab; }, [search.tab]);
  const section = isInventoryTab(search.tab) ? 'inventory' : 'topology';
  return <><PageHeader title={t('cluster.title')} description={t('cluster.description')} actions={<Button onClick={() => refresh.mutate(undefined)} disabled={refresh.isPending}>{t('cluster.refresh')}</Button>} />
    <Stack>
      <ClusterOverviewStrip summary={summary.data} pending={summary.isPending} error={summary.error ?? refresh.error} expired={summary.error?.status === 410} newSnapshot={() => change({})} select={change} />
      <Tabs label={t('cluster.views')} value={section} onChange={(value) => change(value === 'topology' ? { tab: 'topology' } : { tab: lastInventory.current, kind: undefined, purpose: undefined, status: undefined })} items={[{ value: 'topology', label: t('cluster.tab.topology') }, { value: 'inventory', label: t('cluster.inventory') }]}>
        {section === 'topology' ? <ClusterTopology search={search} change={change} go={go} summary={summary.data} snapshotId={snapshotId} /> : <ClusterInventory search={search} change={change} go={go} summary={summary.data} filter={filter} snapshotId={snapshotId} />}
      </Tabs>
    </Stack>
  </>;
}
