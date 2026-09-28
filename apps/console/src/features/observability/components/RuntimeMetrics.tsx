import type { RuntimeUsageMetrics } from '@crewstation/contracts';
import { useT } from '../../../shared/lib/useT';
import { Card } from '../../../shared/ui/Card';
import { runtimeCny, runtimeTokens, runtimeDuration } from '../model/runtimeFormat';
import styles from './RuntimeStatistics.module.css';
export function RuntimeMetrics({ metrics, tasks, duration }: { metrics: RuntimeUsageMetrics; tasks?: number; duration?: number | null }) {
  const t = useT();
  return <div className={styles.grid} data-runtime-metrics>
    <Card title={t('runtime.tokens')}><p className={styles.value}>{runtimeTokens(metrics)}</p><p className={styles.hint}>{t('runtime.coverage', { observed: metrics.observedExecutions, total: metrics.executions })}</p></Card>
    <Card title={t('runtime.cost')}><p className={styles.value} title={metrics.cost.amount ?? undefined}>{runtimeCny(metrics)}</p><p className={styles.hint}>{t(metrics.cost.visible ? 'runtime.cnyHint' : 'runtime.hiddenCost')}</p></Card>
    <Card title={t(tasks === undefined ? 'runtime.executions' : 'runtime.tasks')}><p className={styles.value}>{tasks ?? metrics.executions}</p><p className={styles.hint}>{t('runtime.directHint')}</p></Card>
    {duration !== undefined ? <Card title={t('runtime.wall')}><p className={styles.value}>{runtimeDuration(duration)}</p><p className={styles.hint}>{t('runtime.wallHint')}</p></Card> : null}
  </div>;
}
export function RuntimeTokenBuckets({ metrics }: { metrics: RuntimeUsageMetrics }) {
  const t = useT(); return <dl className={styles.facts}>{(['input', 'cacheRead', 'cacheWrite', 'output'] as const).map((bucket) => <div key={bucket}><dt>{t('runtime.' + bucket)}</dt><dd>{runtimeTokens(metrics, bucket)}</dd></div>)}</dl>;
}
