import type { Actor, UserId } from '@crewstation/contracts';
import { CreateResourceRequestSchema, DecideResourceRequestSchema, ProjectIdSchema, ResourceIdSchema, ResourceRequestQuerySchema, ResourceRequestVersionSchema, ResourceTargetSchema, ResourceTypeSchema, SaveResourceCatalogPolicySchema } from '@crewstation/contracts';
import { actorFrom, parseBody, parseParams, parseQuery } from '@crewstation/http';
import type { AppEnv } from '@crewstation/http';
import { Hono } from 'hono';
import { z } from 'zod';
import type { ResourceAccessModuleApi } from '../api/moduleApi';

const params = z.object({ projectId: ProjectIdSchema, id: ResourceIdSchema.optional() });
export function resourceAccessRoutes(api: ResourceAccessModuleApi, isAdmin: (id: UserId) => Promise<boolean>): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const actor = async (c: Parameters<typeof actorFrom>[0]): Promise<Actor> => { const a = await actorFrom(c, (id) => isAdmin(id as UserId)); return { ...a, userId: a.userId as UserId }; };
  r.use('/v1/projects/:projectId/resource-center/*', async (c, next) => { c.header('Cache-Control', 'private, no-store'); await next(); });
  r.get('/v1/projects/:projectId/resource-center/requests', async (c) => c.json(await api.list(await actor(c), parseParams(c, params).projectId, parseQuery(c, ResourceRequestQuerySchema))));
  r.get('/v1/projects/:projectId/resource-center/requests/:id', async (c) => { const p = parseParams(c, params); return c.json(await api.get(await actor(c), p.projectId, p.id!)); });
  r.post('/v1/projects/:projectId/resource-center/requests', async (c) => c.json(await api.create(await actor(c), parseParams(c, params).projectId, await parseBody(c, CreateResourceRequestSchema)), 202));
  r.post('/v1/projects/:projectId/resource-center/direct', async (c) => c.json(await api.direct(await actor(c), parseParams(c, params).projectId, await parseBody(c, CreateResourceRequestSchema)), 202));
  r.post('/v1/projects/:projectId/resource-center/requests/:id/decision', async (c) => { const p = parseParams(c, params); return c.json(await api.decide(await actor(c), p.projectId, p.id!, await parseBody(c, DecideResourceRequestSchema))); });
  r.post('/v1/projects/:projectId/resource-center/requests/:id/cancel', async (c) => { const p = parseParams(c, params), v = await parseBody(c, ResourceRequestVersionSchema); return c.json(await api.cancel(await actor(c), p.projectId, p.id!, v.expectedVersion)); });
  r.post('/v1/projects/:projectId/resource-center/requests/:id/retry', async (c) => { const p = parseParams(c, params), v = await parseBody(c, ResourceRequestVersionSchema); return c.json(await api.retry(await actor(c), p.projectId, p.id!, v.expectedVersion), 202); });
  r.post('/v1/projects/:projectId/resource-center/inspect', async (c) => c.json(await api.inspect(await actor(c), parseParams(c, params).projectId, await parseBody(c, ResourceTargetSchema))));
  r.get('/v1/projects/:projectId/resource-center/targets/:type', async (c) => c.json(await api.targets(await actor(c), parseParams(c, params).projectId, ResourceTypeSchema.parse(c.req.param('type')))));
  r.put('/v1/projects/:projectId/resource-center/catalog-policy', async (c) => { const input = await parseBody(c, z.object({ target: ResourceTargetSchema, policy: SaveResourceCatalogPolicySchema }).strict()); return c.json(await api.saveCatalogPolicy(await actor(c), parseParams(c, params).projectId, input.target, input.policy)); });
  return r;
}
