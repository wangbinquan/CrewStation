import type { RuntimeUsageMetrics } from '@crewstation/contracts';
import { useT } from '../../../shared/lib/useT';
import { Card } from '../../../shared/ui/Card';
import { runtimeCny, runtimeTokens, runtimeDuration, RUNTIME_TOKEN_BUCKETS } from '../model/runtimeFormat';
import styles from './RuntimeStatistics.module.css';
export function RuntimeMetrics({ metrics, tasks, duration, countLabel }: { metrics: RuntimeUsageMetrics; tasks?: number; duration?: number | null; countLabel?: string }) {
  const t = useT();
  return <div className={styles.grid} data-runtime-metrics>
    <Card title={t('runtime.tokens')}><RuntimeTokenMetric metrics={metrics} summary /><p className={styles.hint}>{t('runtime.coverage', { observed: metrics.observedExecutions, total: metrics.executions })}</p><p className={styles.hint}>{t('runtime.bucketHint')}</p></Card>
    <Card title={t('runtime.cost')}><p className={styles.value} title={metrics.cost.amount ?? undefined}>{runtimeCny(metrics)}</p><p className={styles.hint}>{t(metrics.cost.visible ? 'runtime.cnyHint' : 'runtime.hiddenCost')}</p></Card>
    <Card title={countLabel ?? t(tasks === undefined ? 'runtime.executions' : 'runtime.tasks')}><p className={styles.value}>{tasks ?? metrics.executions}</p><p className={styles.hint}>{t('runtime.directHint')}</p></Card>
    {duration !== undefined ? <Card title={t('runtime.wall')}><p className={styles.value}>{runtimeDuration(duration)}</p><p className={styles.hint}>{t('runtime.wallHint')}</p></Card> : null}
  </div>;
}
export function RuntimeTokenBuckets({ metrics }: { metrics: RuntimeUsageMetrics }) {
  const t = useT(); return <dl className={styles.tokenBuckets} data-token-buckets aria-label={t('runtime.buckets')}>{RUNTIME_TOKEN_BUCKETS.map((bucket) => <div key={bucket} data-token-bucket={bucket}><dt>{t('runtime.' + bucket)}</dt><dd>{runtimeTokens(metrics, bucket) === '—' ? t('runtime.tokenUnknown') : runtimeTokens(metrics, bucket)}</dd></div>)}</dl>;
}

export function RuntimeTokenMetric({ metrics, summary = false }: { metrics: RuntimeUsageMetrics; summary?: boolean }) {
  return <div className={styles.tokenMetric}><strong className={summary ? styles.value : undefined}>{runtimeTokens(metrics)}</strong><RuntimeTokenBuckets metrics={metrics} /></div>;
}
