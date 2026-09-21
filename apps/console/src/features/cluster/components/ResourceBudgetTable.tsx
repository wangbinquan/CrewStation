import type { ClusterDemand } from '@crewstation/contracts';
import { useT } from '../../../shared/lib/useT';
import { DataTable } from '../../../shared/ui/DataTable';
import { percent, resourceAmount } from './MetricValue';
import styles from './Metrics.module.css';

export function ResourceBudgetTable({ demand, capacity = {}, allocatable = {} }: { demand: ClusterDemand; capacity?: Record<string, string>; allocatable?: Record<string, string> }) {
  const t = useT(), keys = [...new Set([...Object.keys(capacity), ...Object.keys(allocatable), ...Object.keys(demand.requests), ...Object.keys(demand.limits), ...Object.keys(demand.unboundedLimits)])];
  return <><DataTable className={styles.budgetTable} columns={[t('cluster.metrics.resource'), t('cluster.metrics.capacity'), t('cluster.metrics.allocatable'), t('cluster.metrics.requests'), t('cluster.metrics.requestRatio'), t('cluster.metrics.limits')]}>
    {keys.map((key) => <tr key={key}><td>{key}</td><td>{resourceAmount(capacity[key], key)}</td><td>{resourceAmount(allocatable[key], key)}</td><td>{resourceAmount(demand.requests[key] ?? '0', key)}{demand.missingRequests[key] ? <small>{t('cluster.metrics.missingRequests', { count: demand.missingRequests[key] })}</small> : null}</td><td>{percent(demand.requests[key] ?? '0', allocatable[key])}</td><td>{resourceAmount(demand.limits[key], key)}{demand.unboundedLimits[key] ? <small>{t('cluster.metrics.unbounded', { count: demand.unboundedLimits[key] })}</small> : null}</td></tr>)}
  </DataTable>{demand.errors.length ? <p role="status">{demand.errors.join('; ')}</p> : null}</>;
}
