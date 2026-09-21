import { useNavigate, useSearch } from '@tanstack/react-router';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { Stack } from '../../../shared/ui/Stack';
import { ActionRow } from '../../../shared/ui/ActionRow';
import { Card } from '../../../shared/ui/Card';
import { Tabs } from '../../../shared/ui/Tabs';
import { Button } from '../../../shared/ui/Button';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { ClusterFilters } from '../components/ClusterFilters';
import { ClusterTable } from '../components/ClusterTable';
import { ClusterDetail } from '../components/ClusterDetail';
import { ClusterCapacityPanel, UsageSummary } from '../components/ClusterCapacity';
import { ClusterNodes } from '../components/ClusterNodes';
import { ClusterStorage } from '../components/ClusterStorage';
import { ClusterHistoryBrowser } from '../components/ClusterHistory';
import { ClusterOperations } from '../components/ClusterOperations';
import type { ClusterSearch } from '../model/clusterSearch';
import { parseClusterSearch, clusterFilter, changeClusterFilter } from '../model/clusterSearch';
import styles from '../components/Cluster.module.css';

export function ClusterPage() {
  const t = useT(), navigate = useNavigate(), search = parseClusterSearch(useSearch({ strict: false })), filter = clusterFilter(search);
  const go = (next: ClusterSearch) => { void navigate({ to: '/admin/cluster', search: next, resetScroll: false }); };
  const change = (patch: ClusterSearch) => go(changeClusterFilter(search, patch));
  const summary = useApiQuery(queryKeys.cluster('summary', filter), () => api.cluster.summary(filter), { refetchIntervalMs: 15_000, refetchOnWindowFocus: true });
  const snapshotId = search.snapshotId ?? summary.data?.snapshotId;
  const rows = useApiQuery(queryKeys.cluster('resources', { ...filter, snapshotId }), () => api.cluster.resources({ ...filter, snapshotId }), { enabled: !!snapshotId && !['operations', 'nodes', 'history'].includes(search.tab ?? '') });
  const usageQuery = { resourceIds: rows.data?.items.filter((r) => r.kind === 'Pod' || r.kind === 'PersistentVolumeClaim').map((r) => r.resourceId) ?? [], scope: filter.scope, projectId: filter.projectId };
  const usage = useApiQuery(queryKeys.cluster('page-usage', usageQuery), () => api.cluster.usage(usageQuery), { enabled: !!rows.data && (search.tab === 'pods' || search.tab === 'storage'), refetchIntervalMs: 15_000 });
  const refresh = useApiMutation(() => api.cluster.refresh(), { invalidate: [['cluster']], onSuccess: () => change({}) });
  const s = summary.data;
  const cards = [
    { label: 'workloads', number: s?.workloads, patch: { tab: 'workloads' } }, { label: 'pods', number: s?.pods, patch: { tab: 'pods' } },
    { label: 'services', number: s?.services, patch: { tab: 'network', kind: 'Service' } }, { label: 'pvcs', number: s?.pvcs, patch: { tab: 'storage', kind: 'PersistentVolumeClaim' } }, { label: 'abnormal', number: s?.abnormal, patch: { status: 'abnormal', tab: 'pods' } },
  ] as const;
  return <><PageHeader title={t('cluster.title')} description={t('cluster.description')} actions={<Button onClick={() => refresh.mutate(undefined)} disabled={refresh.isPending}>{t('cluster.refresh')}</Button>} />
    <Stack><ClusterCapacityPanel /><QueryStatus isPending={summary.isPending} error={summary.error ?? refresh.error} />
      {summary.error?.status === 410 ? <Button onClick={() => change({})}>{t('cluster.newSnapshot')}</Button> : null}
      <div className={styles.cards}>{cards.map((c) => <button className={styles.stat} key={c.label} onClick={() => change({ kind: undefined, status: undefined, purpose: undefined, ...c.patch })}><span>{t(`cluster.count.${c.label}`)}</span><strong>{s && !s.complete && c.number === 0 ? '—' : c.number ?? '—'}</strong>{c.label === 'pods' && s ? <span>{t('cluster.podCounts', { running: s.runningPods, ready: s.readyPods })}</span> : <span>{s && !s.complete ? t('cluster.partial') : t('cluster.managed')}</span>}</button>)}</div>
      {s ? <div className={s.complete ? styles.muted : styles.warning}><p>{s.complete ? t('cluster.complete') : t('cluster.partial')} · {t('cluster.observed')} {new Date(s.finishedAt).toLocaleString()}</p><details><summary>{t('cluster.sources')}</summary>{s.sources.map((source) => <p key={source.key}>{source.namespace || '*'} / {source.kind} · {t(`cluster.source.${source.state}`)} · {source.state === 'error' || source.state === 'unsupported' ? '—' : source.count}{source.reason ? ` · ${source.reason}` : ''}</p>)}</details></div> : null}
      {search.tab !== 'nodes' ? <Card compact><ClusterFilters search={search} summary={s} change={change} /></Card> : null}
      <Tabs label={t('cluster.resources')} value={search.tab ?? 'workloads'} onChange={(tab) => change({ tab: tab as ClusterSearch['tab'], kind: undefined, purpose: undefined, status: undefined })} items={['workloads', 'pods', 'network', 'storage', 'nodes', 'history', 'namespaces', 'operations'].map((value) => ({ value, label: t(`cluster.tab.${value}`) }))}>
        {search.tab === 'nodes' ? <ClusterNodes selectPod={(resourceId) => go({ ...search, resourceId })} /> : search.tab === 'history' ? <ClusterHistoryBrowser key={filter.projectId ?? 'all'} projectId={filter.projectId} /> : search.tab === 'operations' ? <ClusterOperations search={search} change={change} /> : <Card title={t('cluster.resourceCount', { count: rows.data?.total === 0 && !rows.data.complete ? '—' : rows.data?.total ?? '—' })} compact stacked>
          <QueryStatus isPending={rows.isPending} error={rows.error} isEmpty={rows.data?.complete === true && rows.data.total === 0} emptyTitle={t('cluster.empty')} />{rows.error?.status === 410 ? <Button onClick={() => change({})}>{t('cluster.newSnapshot')}</Button> : null}
          {search.tab === 'pods' || search.tab === 'storage' ? <><QueryStatus isPending={usage.isPending} error={usage.error} />{usage.data ? <UsageSummary title={t('cluster.metrics.selectedScope')} data={usage.data.summary} /> : null}</> : null}
          {rows.data ? search.tab === 'storage' ? <ClusterStorage rows={rows.data.items} usages={usage.data?.items ?? []} select={(row) => go({ ...search, resourceId: row.resourceId })} /> : <ClusterTable rows={rows.data.items} usages={usage.data?.items} select={(row) => go({ ...search, resourceId: row.resourceId })} /> : null}
          <ActionRow>{search.cursor ? <Button onClick={() => change({})}>{t('cluster.firstPage')}</Button> : null}{rows.data?.nextCursor ? <Button onClick={() => go({ ...search, cursor: rows.data!.nextCursor, snapshotId, resourceId: undefined })}>{t('cluster.nextPage')}</Button> : null}</ActionRow>
        </Card>}
      </Tabs>
      {search.resourceId ? <ClusterDetail key={search.resourceId} resourceId={search.resourceId} snapshotId={snapshotId} close={() => { void navigate({ to: '/admin/cluster', search: { ...search, resourceId: undefined }, resetScroll: false }).then(() => document.querySelector<HTMLButtonElement>(`[data-cluster-resource="${search.resourceId}"]`)?.focus()); }} select={(row) => go({ ...search, resourceId: row.resourceId })} onOperation={(id) => go({ ...search, operationId: id })} /> : null}
    </Stack>
  </>;
}
