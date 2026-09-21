import type { ClusterCoverage, ClusterMetric } from '@crewstation/contracts';
import { useT } from '../../../shared/lib/useT';
import styles from './Metrics.module.css';

export function amount(value: string | number | undefined, unit = 'bytes'): string {
  if (value === undefined || !Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  if (unit === 'cores') return `${n.toLocaleString(undefined, { maximumFractionDigits: 3 })} CPU`;
  if (unit === 'count' || unit === 'ops/s') return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}${unit === 'ops/s' ? '/s' : ''}`;
  const index = Math.max(0, Math.min(5, Math.floor(Math.log2(Math.abs(n) || 1) / 10)));
  return `${(n / 1024 ** index).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'][index]}${unit === 'bytes/s' ? '/s' : ''}`;
}
export const resourceAmount = (value: string | undefined, resource: string) => amount(value, resource === 'cpu' ? 'cores' : resource === 'memory' || resource === 'ephemeral-storage' || resource === 'storage' || resource.startsWith('hugepages-') ? 'bytes' : 'count');
export function percent(numerator: string | undefined, denominator: string | undefined): string {
  return numerator !== undefined && denominator !== undefined && Number(denominator) > 0 ? `${(Number(numerator) / Number(denominator) * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%` : '—';
}
export function MetricValue({ metric, coverage, compact = false }: { metric?: ClusterMetric; coverage?: ClusterCoverage; compact?: boolean }) {
  const t = useT(), state = metric?.state ?? 'unavailable';
  return <span className={styles.metric} data-state={state} title={metric ? `${metric.value ?? '—'} ${metric.unit} · ${metric.source}\n${metric.observedAt ?? ''}\n${metric.reason ?? ''}` : undefined}>
    <strong>{amount(metric?.value, metric?.unit)}</strong>{state !== 'fresh' ? <small>{t(`cluster.metricState.${state}`)}</small> : null}
    {coverage && !coverage.complete ? <small>{t('cluster.metrics.coverage', { fresh: coverage.fresh, expected: coverage.expected })}</small> : null}
    {!compact && metric?.observedAt ? <small>{new Date(metric.observedAt).toLocaleTimeString()} · {metric.source}</small> : null}
    {!compact && metric?.reason ? <small className={styles.reason}>{metric.reason}</small> : null}
  </span>;
}
