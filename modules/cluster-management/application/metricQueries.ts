import type { ProjectResourceMetrics, ProjectResourceMetricsQuery, ProjectResourceHistoryQuery, Actor, ClusterObservationQuery, ClusterUsageQuery, ClusterHistoryQuery, ClusterHistoryResourcesQuery, ClusterMetrics, UserId, ClusterHistory, ClusterHistoryResources, ClusterMetricName } from '@crewstation/contracts';
import { forbidden, notFound, PlatformError, validation } from '@crewstation/kernel';
import { type MetricsDeps, boundedMap } from './observeMetrics';
import type { MetricsObservation } from '../domain/observations';
import type { HistoryReader, PrometheusMatrix } from '../ports/metrics';
import { metricsExposition, historyExpressions, historySelector, historyWindow, metricUnits } from '../domain/history';
import { aggregateMetrics, freshness } from '../domain/metricValues';
import { nodeMetricNames, usageSummary } from '../domain/capacity';

export function currentObservation(input: MetricsObservation, now: number): MetricsObservation {
  const result = structuredClone(input);
  const age = (metrics: ClusterMetrics) => { for (const [name, metric] of Object.entries(metrics)) metrics[name as keyof ClusterMetrics] = freshness(metric!, now, name === 'volumeUsed' ? 180_000 : 45_000); };
  for (const node of result.nodes) { age(node.metrics); Object.values(node.interfaces).forEach(age); Object.values(node.devices).forEach(age); }
  for (const usage of result.usages) { age(usage.metrics); usage.containers.forEach((c) => age(c.metrics)); }
  const capacity = result.capacity;
  Object.assign(capacity, aggregateMetrics(result.nodes.map((n) => n.metrics), nodeMetricNames, now, Date.parse(input.capacity.observedAt)));
  capacity.managed = usageSummary(result.usages, now, Date.parse(input.capacity.observedAt)); capacity.system = usageSummary(result.usages.filter((u) => u.scope === 'system'), now, Date.parse(input.capacity.observedAt));
  capacity.projects = Object.fromEntries(Object.keys(capacity.projects).map((id) => [id, usageSummary(result.usages.filter((u) => u.projectId === id), now, Date.parse(input.capacity.observedAt))]));
  age(capacity.metrics); age(capacity.managed.metrics); age(capacity.system.metrics); Object.values(capacity.projects).forEach((p) => age(p.metrics));
  if (now - Date.parse(capacity.observedAt) > 45_000) capacity.state = 'stale';
  return result;
}
export function metricQueries(deps: MetricsDeps, isAdmin: (id: UserId) => Promise<boolean>, reader: HistoryReader, authorizeProject: (actor: Actor, projectId: string) => Promise<void> = async () => { throw forbidden('Project resource observation is not available'); }) {
  const guard = async (actor: Actor) => { if (!actor.isAdmin || !await isAdmin(actor.userId)) throw forbidden('仅平台管理员可查看集群指标'); };
  const read = async (id?: string) => {
    const observation = id ? await deps.repository.observation(id) : await deps.repository.latest();
    if (id && (!observation || deps.clock.now().getTime() - Date.parse(observation.at) > 600_000)) throw new PlatformError('not_found', '指标分页已过期，请重新加载', { status: 410 });
    if (!observation) throw new PlatformError('unavailable', deps.options.enabled ? 'Waiting for the first metrics collection' : 'Cluster metrics collector has not been configured');
    return currentObservation(observation, deps.clock.now().getTime());
  };
  return {
    projectUsage: async (actor: Actor, projectId: string, query: ProjectResourceMetricsQuery): Promise<ProjectResourceMetrics> => {
      await authorizeProject(actor, projectId);
      const observation = await read(query.observationId), rows = observation.usages.filter((u) => u.scope === 'project' && u.projectId === projectId).sort((a, b) => a.resourceId.localeCompare(b.resourceId));
      const next = query.cursor + query.limit;
      return { observationId: observation.id, observedAt: observation.capacity.observedAt, projectId, total: rows.length, state: observation.capacity.state, complete: observation.identitiesComplete,
        items: rows.slice(query.cursor, next).map(({ resourceId, uid, kind, namespace, name, phase, metrics }) => ({ resourceId, uid, kind, namespace, name, phase, metrics })),
        summary: usageSummary(rows, deps.clock.now().getTime(), Date.parse(observation.capacity.observedAt)), ...(next < rows.length ? { nextCursor: next } : {}) };
    },
    projectHistory: async (actor: Actor, projectId: string, query: ProjectResourceHistoryQuery) => { await authorizeProject(actor, projectId); return queryHistory(deps, reader, { ...query, scope: 'project', projectId }); },
    capacity: async (actor: Actor) => { await guard(actor); return (await read()).capacity; },
    nodes: async (actor: Actor, query: ClusterObservationQuery) => {
      await guard(actor); const observation = await read(query.observationId), rows = [...observation.nodes].sort((a, b) => a.name.localeCompare(b.name)), next = query.cursor + query.limit;
      return { observationId: observation.id, observedAt: observation.at, items: rows.slice(query.cursor, next), total: rows.length, ...(next < rows.length ? { nextCursor: next } : {}) };
    },
    node: async (actor: Actor, id: string, observationId?: string) => { await guard(actor); const node = (await read(observationId)).nodes.find((n) => n.resourceId === id); if (!node) throw notFound('节点', id); return node; },
    usage: async (actor: Actor, query: ClusterUsageQuery) => {
      await guard(actor); const observation = await read(query.observationId), rows = observation.usages.filter((u) => (query.scope === 'all' || u.scope === query.scope) && (!query.projectId || u.projectId === query.projectId));
      return { observationId: observation.id, inventorySnapshotId: observation.inventorySnapshotId, observedAt: observation.at, items: rows.filter((r) => query.resourceIds.includes(r.resourceId)), summary: usageSummary(rows, deps.clock.now().getTime(), Date.parse(observation.capacity.observedAt)) };
    },
    history: async (actor: Actor, query: ClusterHistoryQuery) => { await guard(actor); return queryHistory(deps, reader, query); },
    historyResources: async (actor: Actor, query: ClusterHistoryResourcesQuery) => { await guard(actor); return historyResources(deps, query); },
  };
}
export type ClusterMetricsApi = ReturnType<typeof metricQueries>;

export const renderMetrics = (observation: MetricsObservation, now: number) => metricsExposition(currentObservation(observation, now), now);

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
