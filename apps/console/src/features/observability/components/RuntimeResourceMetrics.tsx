import { useState } from 'react';
import { ClusterCapacitySchema, ClusterHistorySchema, ProjectResourceMetricsSchema, type ClusterUsageSummary } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { AUTO_REFRESH, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Stack } from '../../../shared/ui/Stack';
import { Card } from '../../../shared/ui/Card';
import { ActionRow } from '../../../shared/ui/ActionRow';
import { Button } from '../../../shared/ui/Button';
import { DataTable } from '../../../shared/ui/DataTable';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { TimeSeries } from '../../../shared/ui/TimeSeries';
import { MetricValue, amount } from '../../../shared/ui/metrics/MetricValue';
import type { RuntimeSearch } from '../model/runtimeSearch';
import { runtimeDate } from '../model/runtimeFormat';
import styles from './RuntimeStatistics.module.css';

function ResourceSummary({ title, data }: { title: string; data: ClusterUsageSummary }) {
  const t = useT(); return <Card title={title} stacked><p>{data.pods} Pod · {data.pvcs} PVC</p>
    <dl className={styles.facts}><dt>CPU</dt><dd><MetricValue metric={data.metrics.cpu} coverage={data.coverage.cpu} /></dd>
      <dt>{t('runtime.memory')}</dt><dd><MetricValue metric={data.metrics.memory} coverage={data.coverage.memory} /></dd>
      <dt>{t('runtime.volumeUsed')}</dt><dd><MetricValue metric={data.metrics.volumeUsed} coverage={data.coverage.volumeUsed} /></dd>
      <dt>{t('runtime.storageRequested')}</dt><dd>{amount(data.storageRequested)}</dd><dt>{t('runtime.storageCapacity')}</dt><dd>{amount(data.storageCapacity)}</dd></dl>
  </Card>;
}
function ProjectResources({ projectId }: { projectId: string }) {
  const t = useT(), [generation, setGeneration] = useState(0), [page, setPage] = useState<{ observationId?: string; cursor?: number }>({});
  const query = useApiQuery(['runtime-project-resources', projectId, page, generation], async () => ProjectResourceMetricsSchema.parse(await api.cluster.projectUsage(projectId, { ...page, limit: 100 })), page.observationId ? { refetchOnWindowFocus: false } : AUTO_REFRESH);
  const data = query.error ? undefined : query.data;
  return <Stack>{page.cursor ? <ActionRow><Button onClick={() => { setPage({}); setGeneration((value) => value + 1); }}>{t('runtime.firstResources')}</Button><p className={styles.hint}>{t('runtime.resourcePinned')}</p></ActionRow> : null}
    <QueryStatus isPending={query.isPending} error={query.error} />{data ? <>
      <p className={styles.hint}>{t('runtime.resourceSnapshot', { at: runtimeDate(data.observedAt) })} · {t('cluster.metricState.' + data.state)}</p>{!data.complete ? <p role="status">{t('runtime.projectResourceIncomplete')}</p> : <ResourceSummary title={t('runtime.projectResources')} data={data.summary} />}
      <Card title={t('runtime.resourceDetails')} stacked footer={t(data.complete ? 'runtime.resourcePage' : 'runtime.resourcePartialPage', { shown: data.items.length, total: data.total })}>
        {data.items.length ? <DataTable columns={[t('runtime.resource'), t('runtime.state'), 'CPU', t('runtime.memory'), t('runtime.volumeUsed')]}>{data.items.map((row) => <tr key={row.uid}><td>{row.kind} · {row.name}<span className={styles.identity}>UID {row.uid}</span></td><td>{row.phase}</td><td><MetricValue metric={row.metrics.cpu} compact /></td><td><MetricValue metric={row.metrics.memory} compact /></td><td><MetricValue metric={row.metrics.volumeUsed} compact /></td></tr>)}</DataTable> : data.complete ? <EmptyState title={t('runtime.noResources')} /> : null}
        {data.nextCursor !== undefined ? <Button onClick={() => setPage({ observationId: data.observationId, cursor: data.nextCursor })}>{t('runtime.nextResources')}</Button> : null}
      </Card></> : null}</Stack>;
}
function SystemResources() {
  const t = useT(), query = useApiQuery(['runtime-cluster-capacity'], async () => ClusterCapacitySchema.parse(await api.cluster.capacity()), AUTO_REFRESH), data = query.error ? undefined : query.data;
  return <Stack><QueryStatus isPending={query.isPending} error={query.error} />{data ? <>
    <Card title={t('runtime.clusterCapacity')} stacked><p>{t('runtime.resourceSnapshot', { at: runtimeDate(data.observedAt) })} · {t('cluster.metricState.' + data.state)}</p>
      <p>{t('runtime.nodeCapacity', { ready: data.readyNodes, total: data.nodes, pending: data.pendingPods })}</p>
      <div className={styles.grid}>{(['cpu', 'memory', 'fsUsed', 'networkRx', 'networkTx'] as const).map((key) => <Card key={key} title={key === 'cpu' ? 'CPU' : t('runtime.' + key)}><MetricValue metric={data.metrics[key]} coverage={data.coverage[key]} /></Card>)}</div>
      <dl className={styles.facts}><dt>{t('runtime.cpuRequested')}</dt><dd>{amount(data.demand.requests.cpu, 'cores')} / {amount(data.allocatable.cpu, 'cores')}</dd><dt>{t('runtime.memoryRequested')}</dt><dd>{amount(data.demand.requests.memory)} / {amount(data.allocatable.memory)}</dd></dl>
      {data.errors.length ? <p role="status">{data.errors.join(' · ')}</p> : null}</Card>
    <div className={styles.grid}><ResourceSummary title={t('runtime.managedResources')} data={data.managed} /><ResourceSummary title={t('runtime.platformResources')} data={data.system} /></div>
    <Card title={t('runtime.projectResourceTotals')} footer={t('runtime.capacityScope')}><DataTable columns={[t('runtime.project'), 'Pod / PVC', 'CPU', t('runtime.memory')]}>{Object.entries(data.projects).map(([id, row]) => <tr key={id}><td className={styles.identity}>{id}</td><td>{row.pods} / {row.pvcs}</td><td><MetricValue metric={row.metrics.cpu} coverage={row.coverage.cpu} compact /></td><td><MetricValue metric={row.metrics.memory} coverage={row.coverage.memory} compact /></td></tr>)}</DataTable></Card>
  </> : null}</Stack>;
}
function ResourceHistory({ projectId, search, change }: { projectId?: string; search: RuntimeSearch; change: (value: RuntimeSearch) => void }) {
  const t = useT(), [now] = useState(() => Date.now()), from = search.from ?? new Date(now - 86400000).toISOString(), to = search.to ?? new Date(now).toISOString();
  const valid = Date.parse(to) - Date.parse(from) <= 7 * 86400000;
  const window = { from, to, metrics: ['cpu', 'memory', projectId ? 'volumeUsed' : 'fsUsed'] as ('cpu' | 'memory' | 'volumeUsed' | 'fsUsed')[] };
  const query = useApiQuery(['runtime-resource-history', projectId ?? 'system', window], async () => ClusterHistorySchema.parse(await (projectId ? api.cluster.projectHistory(projectId, window) : api.cluster.history({ ...window, scope: 'cluster' }))), { ...AUTO_REFRESH, enabled: valid });
  return <Card title={t('runtime.resourceHistory')} stacked footer={t('runtime.historyHint')}>
    <ActionRow>{[1, 24, 168].map((hours) => <Button key={hours} onClick={() => { const at = Date.now(); change({ ...search, from: new Date(at - hours * 3600000).toISOString(), to: new Date(at).toISOString() }); }}>{t('runtime.hours', { hours })}</Button>)}</ActionRow>
    <p className={styles.hint}>{runtimeDate(from)} — {runtimeDate(to)}</p>
    {!valid ? <p role="status">{t('runtime.historyLimit')}</p> : <><QueryStatus isPending={query.isPending} error={query.error} />{!query.error && query.data ? <>
      {query.data.state !== 'fresh' ? <p role="status">{query.data.reason ?? t('runtime.historyUnavailable')}</p> : null}
      {query.data.availableFrom ? <p>{t('runtime.historyAvailable', { at: runtimeDate(query.data.availableFrom) })}</p> : null}
      <div className={styles.grid}>{query.data.series.map((series) => <TimeSeries key={series.metric} title={series.metric === 'cpu' ? 'CPU' : t('runtime.' + series.metric)} points={series.points} format={(n) => amount(n, series.unit)} labels={{ average: t('runtime.average'), peak: t('runtime.peak'), coverage: t('runtime.sampleCoverage'), select: t('runtime.selectTime'), gap: t('runtime.sampleGap') }} />)}</div>
    </> : null}</>}
  </Card>;
}
export function RuntimeResourceMetrics(props: { projectId?: string; search: RuntimeSearch; change: (value: RuntimeSearch) => void }) {
  const t = useT(); return <Stack><p className={styles.hint}>{t('runtime.resourceScope')}</p>{props.projectId ? <ProjectResources key={props.projectId} projectId={props.projectId} /> : <SystemResources />}<ResourceHistory {...props} /></Stack>;
}
