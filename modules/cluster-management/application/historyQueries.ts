import type { ClusterHistory, ClusterHistoryQuery, ClusterHistoryResources, ClusterHistoryResourcesQuery, ClusterMetricName } from '@crewstation/contracts';
import { notFound, validation } from '@crewstation/kernel';
import type { HistoryReader, PrometheusMatrix } from '../ports/metrics';
import type { MetricsDeps } from './observeMetrics';
import { boundedMap } from './observeMetrics';
import { historyExpressions, historySelector, historyWindow, metricUnits } from '../domain/history';

function valuesOf(rows: PrometheusMatrix[], query: ClusterHistoryQuery, metric: string): Map<number, number> {
  if (rows.length > 1) throw new Error('History selector returned ambiguous identities');
  for (const row of rows) if (row.metric.scope !== query.scope || row.metric.metric !== metric || (query.resourceId && row.metric.resource_id !== query.resourceId) || (query.container && row.metric.container !== query.container) || (query.projectId && row.metric.project_id !== query.projectId) || (row.metric.device ?? '') !== (query.device ?? '') || (row.metric.interface ?? '') !== (query.interface ?? '')) throw new Error('History labels do not match the selected resource');
  return new Map(rows.flatMap((row) => row.values.map(([at, value]) => [at, Number(value)] as const)));
}
async function series(reader: HistoryReader, query: ClusterHistoryQuery, name: ClusterMetricName, window: ReturnType<typeof historyWindow>, signal: AbortSignal): Promise<ClusterHistory['series'][number]> {
  const results = { average: new Map<number, number>(), peak: new Map<number, number>(), coverage: new Map<number, number>() };
  const read = async (seconds: number, start: number, end: number) => {
    const expressions = historyExpressions(query, name, seconds);
    await Promise.all((['average', 'peak', 'coverage'] as const).map(async (key) => { for (const [at, value] of valuesOf(await reader.range(expressions[key], start, end, window.step, signal), query, name)) results[key].set(at, value); }));
  };
  const fullEnd = window.to - window.remainder;
  if (fullEnd > window.from) await read(window.step, window.from + window.step, fullEnd);
  if (window.remainder) await read(window.remainder, window.to, window.to);
  return { metric: name, unit: metricUnits[name], points: window.ends.map((at) => { const coverage = Math.min(1, Math.max(0, results.coverage.get(at) ?? 0)); return { at: new Date(at * 1000).toISOString(), average: results.average.get(at) ?? null, peak: results.peak.get(at) ?? null, coverage, complete: coverage >= 0.999 && results.average.has(at) }; }) };
}
export async function queryHistory(deps: MetricsDeps, reader: HistoryReader, query: ClusterHistoryQuery): Promise<ClusterHistory> {
  let window: ReturnType<typeof historyWindow>;
  try { window = historyWindow(query, deps.clock.now().getTime()); } catch (error) { throw validation(String(error)); }
  if (query.resourceId && !(await deps.repository.identities()).some((i) => i.resourceId === query.resourceId && ({ node: 'Node', pod: 'Pod', container: 'Pod', pvc: 'PersistentVolumeClaim' } as Record<string, string>)[query.scope] === i.kind)) throw notFound('历史资源', query.resourceId);
  const base = { requestedFrom: query.from, requestedTo: query.to, stepSeconds: window.step, source: 'prometheus' as const };
  try {
    const signal = AbortSignal.timeout(30_000), rows = await boundedMap(query.metrics, 2, (name) => series(reader, query, name, window, signal));
    const firstExpression = `min_over_time(cs_cluster_source_timestamp_seconds{${historySelector(query, query.metrics[0]!)} }[8d])`;
    const start = await reader.range(query.resourceId && !query.projectId ? `min without(project_id) (${firstExpression})` : firstExpression, window.to, window.to, 15, signal);
    const first = [...valuesOf(start, query, query.metrics[0]!).values()].filter((n) => n > 0).sort((a, b) => a - b)[0];
    return { ...base, state: 'fresh', ...(first ? { availableFrom: new Date(first * 1000).toISOString() } : {}), series: rows };
  } catch (error) { return { ...base, state: 'error', reason: error instanceof Error ? error.message : String(error), series: [] }; }
}
export async function historyResources(deps: MetricsDeps, query: ClusterHistoryResourcesQuery): Promise<ClusterHistoryResources> {
  const cutoff = deps.clock.now().getTime() - 8 * 86_400_000;
  const rows = (await deps.repository.identities()).filter((r) => Date.parse(r.lastSeen) >= cutoff && (!query.kind || r.kind === query.kind) && (!query.projectId || r.versions.some((v) => v.projectId === query.projectId)) && (!query.q || `${r.name} ${r.namespace} ${r.uid}`.toLowerCase().includes(query.q.toLowerCase()))).sort((a, b) => b.lastSeen.localeCompare(a.lastSeen) || a.resourceId.localeCompare(b.resourceId));
  const next = query.cursor + query.limit;
  return { items: rows.slice(query.cursor, next), total: rows.length, ...(next < rows.length ? { nextCursor: next } : {}) };
}
