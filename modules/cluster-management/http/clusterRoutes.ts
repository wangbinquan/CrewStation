import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppEnv } from '@crewstation/http';
import { actorFrom, parseBody, parseQuery, mapErrorToResponse } from '@crewstation/http';
import { isPlatformError } from '@crewstation/kernel';
import type { UserId } from '@crewstation/contracts';
import { ClusterFilterSchema, ClusterLogsQuerySchema, ClusterInspectRequestSchema, ClusterOperationRequestSchema, ClusterOperationQuerySchema } from '@crewstation/contracts';
import type { ClusterManagementModuleApi } from '../api/moduleApi';
export function clusterRoutes(api: ClusterManagementModuleApi, isAdmin: (id: UserId) => Promise<boolean>): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.onError((error, c) => isPlatformError(error) && error.kind === 'not_found' && error.details?.status === 410 ? c.json({ error: error.kind, message: error.message, details: error.details }, 410) : mapErrorToResponse(error, c));
  const actor = async (c: Context<AppEnv>) => { const a = await actorFrom(c, (id) => isAdmin(id as UserId)); return { userId: a.userId as UserId, isAdmin: a.isAdmin }; };
  r.get('/v1/admin/cluster/summary', async (c) => c.json(await api.summary(await actor(c), parseQuery(c, ClusterFilterSchema))));
  r.get('/v1/admin/cluster/resources', async (c) => c.json(await api.resources(await actor(c), parseQuery(c, ClusterFilterSchema))));
  r.get('/v1/admin/cluster/resources/:id', async (c) => c.json(await api.detail(await actor(c), c.req.param('id'), c.req.query('snapshotId'))));
  r.get('/v1/admin/cluster/resources/:id/events', async (c) => c.json(await api.events(await actor(c), c.req.param('id'))));
  r.get('/v1/admin/cluster/resources/:id/logs', async (c) => c.json(await api.logs(await actor(c), c.req.param('id'), parseQuery(c, ClusterLogsQuerySchema))));
  r.post('/v1/admin/cluster/refresh', async (c) => c.json(await api.refresh(await actor(c)), 202));
  r.post('/v1/admin/cluster/resources/:id/inspect-operation', async (c) => c.json(await api.inspect(await actor(c), c.req.param('id'), await parseBody(c, ClusterInspectRequestSchema))));
  r.post('/v1/admin/cluster/operations', async (c) => c.json(await api.accept(await actor(c), await parseBody(c, ClusterOperationRequestSchema)), 202));
  r.get('/v1/admin/cluster/operations', async (c) => c.json(await api.operations(await actor(c), parseQuery(c, ClusterOperationQuerySchema))));
  r.get('/v1/admin/cluster/operations/:id', async (c) => c.json(await api.operation(await actor(c), c.req.param('id'))));
  r.post('/v1/admin/cluster/operations/:id/reconcile', async (c) => c.json(await api.reconcile(await actor(c), c.req.param('id')), 202));
  return r;
}
