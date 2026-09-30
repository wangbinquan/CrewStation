import type { ResourceQuotaMetric } from '@crewstation/contracts';
import { useT } from '../../../shared/lib/useT';
import { DataTable } from '../../../shared/ui/DataTable';
import { metricLabel, metricLimit, numberText } from '../model/workspace';
import styles from './ResourceCenter.module.css';

export function ResourceMetrics({ metrics }: { metrics: ResourceQuotaMetric[] }) {
  const t = useT();
  if (!metrics.length) return <p className={styles.muted}>{t('resourceCenter.noQuota')}</p>;
  return <DataTable columns={['metric', 'used', 'reserved', 'limit', 'requestedLimit'].map((v) => t(`resourceCenter.${v}`))}>{metrics.map((metric) => <tr key={`${metric.scopeId}:${metric.key}`}>
    <td>{metricLabel(metric, t)}<small className={styles.block}>{t('resourceCenter.scope')}: {metric.scopeId}</small></td><td>{numberText(metric.used)}</td><td>{numberText(metric.reserved)}</td><td>{metricLimit(metric, t)}</td><td>{metric.requestedLimit === null ? '—' : `${numberText(metric.requestedLimit)} ${metric.unit}`}</td>
  </tr>)}</DataTable>;
}
