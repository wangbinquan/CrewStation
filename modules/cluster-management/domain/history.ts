import type { ClusterHistoryQuery, ClusterMetricName, ClusterMetrics } from '@crewstation/contracts';
import type { MetricsObservation } from './observations';
import { freshness } from './metricValues';
import { metricUnits } from './observations';

const labels = (values: Record<string, string>) => Object.entries(values).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(',');
export function metricsExposition(observation: MetricsObservation, now: number): string {
  const lines = ['# HELP cs_cluster_value Current observed resource values (missing values are omitted).', '# TYPE cs_cluster_value gauge', '# TYPE cs_cluster_source_timestamp_seconds gauge', '# TYPE cs_cluster_coverage gauge'];
  const emit = (scope: string, metrics: ClusterMetrics, identity: Record<string, string> = {}, coverage: Partial<Record<ClusterMetricName, { fresh: number; expected: number }>> = {}) => {
    for (const [key, raw] of Object.entries(metrics)) {
      const name = key as ClusterMetricName, value = freshness(raw!, now, name === 'volumeUsed' ? 180_000 : 45_000);
      const keys = labels({ scope, resource_id: '', uid: '', project_id: '', container: '', device: '', interface: '', ...identity, metric: name });
      const c = coverage[name], fraction = value.state === 'fresh' ? c && c.expected ? c.fresh / c.expected : 1 : 0;
      lines.push(`cs_cluster_coverage{${keys}} ${fraction}`);
      if (value.state !== 'fresh' || value.value === undefined || !Number.isFinite(Number(value.value)) || !value.observedAt) continue;
      lines.push(`cs_cluster_value{${keys}} ${value.value}`, `cs_cluster_source_timestamp_seconds{${keys}} ${Date.parse(value.observedAt) / 1000}`);
    }
  };
  emit('cluster', observation.capacity.metrics, {}, observation.capacity.coverage);
  emit('system', observation.capacity.system.metrics, {}, observation.capacity.system.coverage);
  for (const [project_id, summary] of Object.entries(observation.capacity.projects)) emit('project', summary.metrics, { project_id }, summary.coverage);
  for (const node of observation.nodes) {
    const identity = { resource_id: node.resourceId, uid: node.uid }; emit('node', node.metrics, identity);
    for (const [device, metrics] of Object.entries(node.devices)) emit('node', metrics, { ...identity, device });
    for (const [net, metrics] of Object.entries(node.interfaces)) emit('node', metrics, { ...identity, interface: net });
  }
  for (const row of observation.usages) {
    const identity = { resource_id: row.resourceId, uid: row.uid, project_id: row.projectId ?? '' };
    emit(row.kind === 'Pod' ? 'pod' : 'pvc', row.metrics, identity);
    for (const container of row.containers) emit('container', container.metrics, { ...identity, container: container.name });
  }
  return `${lines.join('\n')}\n`;
}
export function historySelector(query: ClusterHistoryQuery, metric: ClusterMetricName): string {
  return labels({ scope: query.scope, metric, ...(query.resourceId ? { resource_id: query.resourceId } : {}), ...(query.projectId ? { project_id: query.projectId } : {}), container: query.container ?? '', device: query.device ?? '', interface: query.interface ?? '' });
}
export function historyExpressions(query: ClusterHistoryQuery, name: ClusterMetricName, seconds: number): { average: string; peak: string; coverage: string } {
  const selector = historySelector(query, name), timestamp = `cs_cluster_source_timestamp_seconds{${selector}}`, fresh = `(time() - ${timestamp} < ${name === 'volumeUsed' ? 180 : 45})`;
  const instance = (metric: string) => {
    const valid = `(${metric}{${selector}} and ${fresh})`;
    // Ownership can change while the Kubernetes UID stays the same. Choose the newest source
    // instant first, then remove that changing label before bucketing; never add both owners.
    return query.resourceId && !query.projectId ? `(sum without(project_id) (${valid} and topk by(scope,resource_id,uid,container,device,interface,metric) (1, ${timestamp})))` : valid;
  };
  const value = instance('cs_cluster_value'), covered = instance('cs_cluster_coverage');
  const window = `${seconds}s:15s`, expected = Math.max(1, seconds / 15);
  return { average: `avg_over_time(${value}[${window}])`, peak: `max_over_time(${value}[${window}])`, coverage: `clamp_max(sum_over_time(${covered}[${window}]) / ${expected}, 1)` };
}
export function historyWindow(query: ClusterHistoryQuery, now: number) {
  const from = Math.floor(Date.parse(query.from) / 1000), to = Math.floor(Date.parse(query.to) / 1000), span = to - from;
  if (from < Math.floor(now / 1000) - 7 * 86400 - 30 || to > now / 1000 + 30 || span <= 0 || span > 7 * 86400) throw new Error('History range must be within the latest 7 days');
  const step = span <= 3600 ? 15 : span <= 86400 ? 60 : 600;
  const ends: number[] = []; for (let end = from + step; end < to; end += step) ends.push(end); ends.push(to);
  if (ends.length > 1440) throw new Error('History query exceeds 1440 buckets');
  return { from, to, step, ends, remainder: span % step };
}
export { metricUnits };
