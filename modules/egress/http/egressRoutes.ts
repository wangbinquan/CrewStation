import { AddEgressEntryRequestSchema, DecideEgressRequestSchema, ProjectIdSchema, RequestEgressEntryRequestSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { parseBody, parseParams, parseQuery } from '@crewstation/http';
import { Hono } from 'hono';
import { z } from 'zod';
import type { EgressModuleApi } from '../api/moduleApi';
import type { ActorResolver } from './actor';
import { actorFrom } from './actor';

const projectParams = z.object({ projectId: ProjectIdSchema });
const idParams = z.object({ id: z.string().min(1) });
const projectQuery = z.object({ projectId: ProjectIdSchema.optional() });

/** 白名单条目（管理员）、追加申请与裁定、被阻请求；用户域路由。 */
export function egressRoutes(api: EgressModuleApi, actors: ActorResolver): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.get('/v1/egress/entries', async (c) => c.json({ items: await api.listEntries(await actorFrom(c, actors), parseQuery(c, projectQuery).projectId) }));
  r.post('/v1/egress/entries', async (c) => c.json(await api.addEntry(await actorFrom(c, actors), await parseBody(c, AddEgressEntryRequestSchema)), 201));
  r.delete('/v1/egress/entries/:id', async (c) => {
    await api.removeEntry(await actorFrom(c, actors), parseParams(c, idParams).id);
    return c.body(null, 204);
  });
  r.get('/v1/projects/:projectId/egress/requests', async (c) => c.json({ items: await api.listRequests(await actorFrom(c, actors), parseParams(c, projectParams).projectId) }));
  r.post('/v1/projects/:projectId/egress/requests', async (c) => {
    const { projectId } = parseParams(c, projectParams);
    return c.json(await api.requestEntry(await actorFrom(c, actors), projectId, await parseBody(c, RequestEgressEntryRequestSchema)), 201);
  });
  r.get('/v1/egress/requests', async (c) => c.json({ items: await api.listRequests(await actorFrom(c, actors), parseQuery(c, projectQuery).projectId) }));
  r.post('/v1/egress/requests/:id/decision', async (c) => c.json(await api.decideRequest(await actorFrom(c, actors), parseParams(c, idParams).id, await parseBody(c, DecideEgressRequestSchema))));
  r.get('/v1/projects/:projectId/egress/blocked', async (c) => c.json({ items: await api.listBlocked(await actorFrom(c, actors), parseParams(c, projectParams).projectId) }));
  return r;
}
