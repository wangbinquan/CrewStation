import type { ProjectId, TraceId, UserId } from '@crewstation/contracts';
import { LogQuerySchema, ProjectIdSchema, TraceIdSchema, UserIdSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { actorFrom, parseBody, parseParams, parseQuery } from '@crewstation/http';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import type { ObservabilityModuleApi } from '../api/moduleApi';

const projectParams = z.object({ projectId: ProjectIdSchema });
const subscribeBody = z.object({ userId: UserIdSchema, channel: z.enum(['workbench', 'webhook']), target: z.string().optional() });

export function observabilityRoutes(api: ObservabilityModuleApi, isAdmin: (userId: UserId) => Promise<boolean>): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const actor = async (c: Context<AppEnv>) => { const a = await actorFrom(c, (id) => isAdmin(id as UserId)); return { userId: a.userId as UserId, isAdmin: a.isAdmin }; };
  const pid = (c: Context<AppEnv>) => parseParams(c, projectParams).projectId as ProjectId;
  r.get('/v1/projects/:projectId/logs', async (c) => c.json({ items: await api.queryLogs(await actor(c), pid(c), parseQuery(c, LogQuerySchema)) }));
  r.get('/v1/projects/:projectId/health', async (c) => c.json({ items: await api.health(await actor(c), pid(c)) }));
  r.get('/v1/projects/:projectId/alerts', async (c) => c.json({ items: await api.listAlerts(await actor(c), pid(c)) }));
  r.get('/v1/projects/:projectId/alert-subscriptions', async (c) => c.json({ items: await api.listSubscriptions(await actor(c), pid(c)) }));
  r.put('/v1/projects/:projectId/alert-subscriptions', async (c) => { await api.subscribe(await actor(c), pid(c), await parseBody(c, subscribeBody)); return c.body(null, 204); });
  r.delete('/v1/projects/:projectId/alert-subscriptions/:userId', async (c) => { await api.unsubscribe(await actor(c), pid(c), parseParams(c, projectParams.extend({ userId: UserIdSchema })).userId as UserId); return c.body(null, 204); });
  r.get('/v1/projects/:projectId/traces/:traceId', async (c) => { const p = parseParams(c, projectParams.extend({ traceId: TraceIdSchema })); return c.json(await api.replayTrace(await actor(c), p.projectId as ProjectId, p.traceId as TraceId)); });
  return r;
}
