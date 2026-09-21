import { timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppEnv } from '@crewstation/http';
import { actorFrom, mapErrorToResponse, parseQuery } from '@crewstation/http';
import { isPlatformError } from '@crewstation/kernel';
import type { UserId } from '@crewstation/contracts';
import { ClusterObservationQuerySchema, ClusterUsageQuerySchema, ClusterHistoryQuerySchema, ClusterHistoryResourcesQuerySchema } from '@crewstation/contracts';
import type { ClusterMetricsApi } from '../application/metricQueries';
import { renderMetrics } from '../application/metricQueries';
import type { MetricsDeps } from '../application/observeMetrics';

export function metricsRoutes(api: ClusterMetricsApi, isAdmin: (id: UserId) => Promise<boolean>) {
  const r = new Hono<AppEnv>();
  r.onError((error, c) => isPlatformError(error) && error.kind === 'not_found' && error.details?.status === 410 ? c.json({ error: error.kind, message: error.message, details: error.details }, 410) : mapErrorToResponse(error, c));
  const actor = async (c: Context<AppEnv>) => { const a = await actorFrom(c, (id) => isAdmin(id as UserId)); return { userId: a.userId as UserId, isAdmin: a.isAdmin }; };
  r.get('/v1/admin/cluster/capacity', async (c) => c.json(await api.capacity(await actor(c))));
  r.get('/v1/admin/cluster/nodes', async (c) => c.json(await api.nodes(await actor(c), parseQuery(c, ClusterObservationQuerySchema))));
  r.get('/v1/admin/cluster/nodes/:id', async (c) => c.json(await api.node(await actor(c), c.req.param('id'), c.req.query('observationId'))));
  r.get('/v1/admin/cluster/usage', async (c) => c.json(await api.usage(await actor(c), parseQuery(c, ClusterUsageQuerySchema))));
  r.get('/v1/admin/cluster/history', async (c) => c.json(await api.history(await actor(c), parseQuery(c, ClusterHistoryQuerySchema))));
  r.get('/v1/admin/cluster/history/resources', async (c) => c.json(await api.historyResources(await actor(c), parseQuery(c, ClusterHistoryResourcesQuerySchema))));
  return r;
}
export function metricsExporter(deps: MetricsDeps) {
  const r = new Hono<AppEnv>();
  r.get('/internal/cluster/metrics', async (c) => {
    const expected = Buffer.from(`Bearer ${deps.options.exporterToken}`), supplied = Buffer.from(c.req.header('authorization') ?? '');
    if (!deps.options.exporterToken || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return c.text('Unauthorized', 401);
    const observation = await deps.repository.latest(); if (!observation) return c.text('Waiting for metrics', 503);
    const now = deps.clock.now().getTime();
    return c.text(renderMetrics(observation, now), 200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' });
  });
  return r;
}
