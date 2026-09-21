import type { ClusterCapacity as Capacity, ClusterUsageSummary } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { useApiQuery } from '../../../shared/api/useApi';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useT } from '../../../shared/lib/useT';
import { Card } from '../../../shared/ui/Card';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { MetricValue, amount, percent } from './MetricValue';
import { ResourceBudgetTable } from './ResourceBudgetTable';
import styles from './Metrics.module.css';

export function ClusterCapacityPanel() {
  const t = useT(), query = useApiQuery(queryKeys.cluster('capacity'), () => api.cluster.capacity(), { refetchIntervalMs: 15_000, refetchOnWindowFocus: true });
  return <Card title={t('cluster.metrics.global')} stacked><p className={styles.caption}>{t('cluster.metrics.globalScope')}</p><QueryStatus isPending={query.isPending} error={query.error} />{query.data ? <CapacityContent data={query.data} /> : null}</Card>;
}
function CapacityContent({ data: d }: { data: Capacity }) {
  const t = useT();
  return <><div className={styles.overview}>
    <article><h3>{t('cluster.metrics.nodes')}</h3><strong className={styles.hero}>{d.nodes}</strong><p>{t('cluster.metrics.nodeCounts', { ready: d.readyNodes, schedulable: d.schedulableNodes })}</p><p>{t('cluster.metrics.podCounts', { pods: d.podCount, pending: d.pendingPods })}</p></article>
    <article><h3>CPU</h3><MetricValue metric={d.metrics.cpu} coverage={d.coverage.cpu} /><p>{t('cluster.metrics.usedRatio')} {percent(d.coverage.cpu?.complete && d.metrics.cpu?.state === 'fresh' ? d.metrics.cpu.value : undefined, d.capacity.cpu)}</p><p>{t('cluster.metrics.capacity')} {amount(d.capacity.cpu, 'cores')}</p><p>{t('cluster.metrics.requests')} {amount(d.demand.requests.cpu ?? '0', 'cores')} / {amount(d.allocatable.cpu, 'cores')}</p></article>
    <article><h3>{t('cluster.metrics.memory')}</h3><MetricValue metric={d.metrics.memory} coverage={d.coverage.memory} /><p>{t('cluster.metrics.workingSet')} · {percent(d.coverage.memory?.complete && d.metrics.memory?.state === 'fresh' ? d.metrics.memory.value : undefined, d.capacity.memory)}</p><p>{t('cluster.metrics.capacity')} {amount(d.capacity.memory)}</p><p>{t('cluster.metrics.requests')} {amount(d.demand.requests.memory ?? '0')} / {amount(d.allocatable.memory)}</p></article>
    <article><h3>{t('cluster.metrics.disk')}</h3><MetricValue metric={d.metrics.fsUsed} coverage={d.coverage.fsUsed} /><p>{t('cluster.metrics.capacity')} <MetricValue metric={d.metrics.fsCapacity} compact /></p><p>{t('cluster.metrics.available')} <MetricValue metric={d.metrics.fsAvailable} compact /></p></article>
    <article><h3>{t('cluster.metrics.network')}</h3><p>↓ <MetricValue metric={d.metrics.networkRx} coverage={d.coverage.networkRx} /></p><p>↑ <MetricValue metric={d.metrics.networkTx} coverage={d.coverage.networkTx} /></p><small>{t('cluster.metrics.defaultInterface')}</small></article>
  </div><p className={styles.caption}>{t('cluster.observed')} {new Date(d.observedAt).toLocaleString()} · {t(`cluster.metricState.${d.state}`)}</p>{d.errors.length ? <details className={styles.warning}><summary>{t('cluster.metrics.sourceErrors', { count: d.errors.length })}</summary>{d.errors.map((error) => <p key={error}>{error}</p>)}</details> : null}
  <details><summary>{t('cluster.metrics.capacityDetails')}</summary><ResourceBudgetTable demand={d.demand} capacity={d.capacity} allocatable={d.allocatable} /><p>{t('cluster.metrics.pendingDemand')}</p><ResourceBudgetTable demand={d.pendingDemand} /><p className={styles.caption}>{t('cluster.metrics.extendedHint')}</p></details>
  <details><summary>{t('cluster.metrics.managedSplit')}</summary><div className={styles.split}><UsageSummary title={t('cluster.all')} data={d.managed} /><UsageSummary title={t('cluster.system')} data={d.system} /></div><p className={styles.caption}>{t('cluster.metrics.noDoubleCount')}</p></details></>;
}
export function UsageSummary({ title, data }: { title: string; data: ClusterUsageSummary }) {
  const t = useT();
  return <article className={styles.summary}><strong>{title}</strong><span>{data.pods} Pod · {data.pvcs} PVC</span><span>CPU <MetricValue metric={data.metrics.cpu} coverage={data.coverage.cpu} compact /></span><span>{t('cluster.metrics.memory')} <MetricValue metric={data.metrics.memory} coverage={data.coverage.memory} compact /></span><span>{t('cluster.metrics.storageRequested')} {amount(data.storageRequested)}</span><span>{t('cluster.metrics.storageCapacity')} {amount(data.storageCapacity)}</span><span>{t('cluster.metrics.storageUsed')} <MetricValue metric={data.metrics.volumeUsed} coverage={data.coverage.volumeUsed} compact /></span></article>;
}
