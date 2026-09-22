import type { ClusterCapacity as Capacity, ClusterCoverage, ClusterMetric, ClusterUsageSummary } from '@crewstation/contracts';
import { useT } from '../../../shared/lib/useT';
import { MetricValue, amount, percent } from './MetricValue';
import { ResourceBudgetTable } from './ResourceBudgetTable';
import styles from './Cluster.module.css';
import metricStyles from './Metrics.module.css';

/** 只有覆盖完整且实时的值才拿去算占比；部分合计或过期值算出的百分比会误导。 */
const fresh = (metric?: ClusterMetric, coverage?: ClusterCoverage) => coverage?.complete && metric?.state === 'fresh' ? metric.value : undefined;

/** 集群容量五格（2026-09-23 裁定压成一条）：标题、主数值、两行副文字；采集时间、来源与申请／限制明细在 CapacityDetails。 */
export function CapacityTiles({ data: d }: { data: Capacity }) {
  const t = useT();
  return <>
    <article className={styles.tile}><span className={styles.tileTitle}>{t('cluster.metrics.nodes')}</span><strong className={styles.hero}>{d.nodes}</strong><small>{t('cluster.metrics.nodeCounts', { ready: d.readyNodes, schedulable: d.schedulableNodes })}</small><small>{t('cluster.metrics.podCounts', { pods: d.podCount, pending: d.pendingPods })}</small></article>
    <article className={styles.tile}><span className={styles.tileTitle}>CPU</span><span className={styles.hero}><MetricValue metric={d.metrics.cpu} coverage={d.coverage.cpu} compact /></span><small>{t('cluster.metrics.usedRatio')} {percent(fresh(d.metrics.cpu, d.coverage.cpu), d.capacity.cpu)}</small><small>{t('cluster.metrics.requests')} {amount(d.demand.requests.cpu ?? '0', 'cores')} / {amount(d.allocatable.cpu, 'cores')}</small></article>
    <article className={styles.tile}><span className={styles.tileTitle}>{t('cluster.metrics.memory')}</span><span className={styles.hero}><MetricValue metric={d.metrics.memory} coverage={d.coverage.memory} compact /></span><small>{t('cluster.metrics.workingSet')} · {percent(fresh(d.metrics.memory, d.coverage.memory), d.capacity.memory)}</small><small>{t('cluster.metrics.requests')} {amount(d.demand.requests.memory ?? '0')} / {amount(d.allocatable.memory)}</small></article>
    <article className={styles.tile}><span className={styles.tileTitle}>{t('cluster.metrics.disk')}</span><span className={styles.hero}><MetricValue metric={d.metrics.fsUsed} coverage={d.coverage.fsUsed} compact /></span><small>{t('cluster.metrics.capacity')} <MetricValue metric={d.metrics.fsCapacity} compact /></small><small>{t('cluster.metrics.available')} <MetricValue metric={d.metrics.fsAvailable} compact /></small></article>
    <article className={styles.tile} title={t('cluster.metrics.defaultInterface')}><span className={styles.tileTitle}>{t('cluster.metrics.network')}</span><span className={styles.rate}>↓ <MetricValue metric={d.metrics.networkRx} coverage={d.coverage.networkRx} compact /></span><span className={styles.rate}>↑ <MetricValue metric={d.metrics.networkTx} coverage={d.coverage.networkTx} compact /></span></article>
  </>;
}

/** 折叠行里的明细：口径说明、来源问题、容量／申请／限制表、未调度申请、受管分项。 */
export function CapacityDetails({ data: d }: { data: Capacity }) {
  const t = useT();
  return <>
    <h3>{t('cluster.metrics.global')}</h3><p className={metricStyles.caption}>{t('cluster.metrics.globalScope')} {t('cluster.metrics.defaultInterface')}</p>
    {d.errors.length ? <details className={metricStyles.warning}><summary>{t('cluster.metrics.sourceErrors', { count: d.errors.length })}</summary>{d.errors.map((error) => <p key={error}>{error}</p>)}</details> : null}
    <h3>{t('cluster.metrics.capacityDetails')}</h3><ResourceBudgetTable demand={d.demand} capacity={d.capacity} allocatable={d.allocatable} /><p>{t('cluster.metrics.pendingDemand')}</p><ResourceBudgetTable demand={d.pendingDemand} /><p className={metricStyles.caption}>{t('cluster.metrics.extendedHint')}</p>
    <h3>{t('cluster.metrics.managedSplit')}</h3><div className={metricStyles.split}><UsageSummary title={t('cluster.all')} data={d.managed} /><UsageSummary title={t('cluster.system')} data={d.system} /></div><p className={metricStyles.caption}>{t('cluster.metrics.noDoubleCount')}</p>
  </>;
}

export function UsageSummary({ title, data }: { title: string; data: ClusterUsageSummary }) {
  const t = useT();
  return <article className={metricStyles.summary}><strong>{title}</strong><span>{data.pods} Pod · {data.pvcs} PVC</span><span>CPU <MetricValue metric={data.metrics.cpu} coverage={data.coverage.cpu} compact /></span><span>{t('cluster.metrics.memory')} <MetricValue metric={data.metrics.memory} coverage={data.coverage.memory} compact /></span><span>{t('cluster.metrics.storageRequested')} {amount(data.storageRequested)}</span><span>{t('cluster.metrics.storageCapacity')} {amount(data.storageCapacity)}</span><span>{t('cluster.metrics.storageUsed')} <MetricValue metric={data.metrics.volumeUsed} coverage={data.coverage.volumeUsed} compact /></span></article>;
}
