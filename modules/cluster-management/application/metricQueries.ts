import type { Actor, ClusterObservationQuery, ClusterUsageQuery, ClusterHistoryQuery, ClusterHistoryResourcesQuery, ClusterMetrics, UserId } from '@crewstation/contracts';
import { forbidden, notFound, PlatformError } from '@crewstation/kernel';
import type { MetricsDeps } from './observeMetrics';
import type { MetricsObservation } from '../domain/observations';
import type { HistoryReader } from '../ports/metrics';
import { metricsExposition } from '../domain/history';
import { aggregateMetrics, freshness } from '../domain/metricValues';
import { nodeMetricNames, usageSummary } from '../domain/capacity';
import { queryHistory, historyResources } from './historyQueries';

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
export function metricQueries(deps: MetricsDeps, isAdmin: (id: UserId) => Promise<boolean>, reader: HistoryReader) {
  const guard = async (actor: Actor) => { if (!actor.isAdmin || !await isAdmin(actor.userId)) throw forbidden('仅平台管理员可查看集群指标'); };
  const read = async (id?: string) => {
    const observation = id ? await deps.repository.observation(id) : await deps.repository.latest();
    if (id && (!observation || deps.clock.now().getTime() - Date.parse(observation.at) > 600_000)) throw new PlatformError('not_found', '指标分页已过期，请重新加载', { status: 410 });
    if (!observation) throw new PlatformError('unavailable', deps.options.enabled ? 'Waiting for the first metrics collection' : 'Cluster metrics collector has not been configured');
    return currentObservation(observation, deps.clock.now().getTime());
  };
  return {
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
