import { DeveloperAccessQuerySchema, RequestDeveloperAccessSchema, ResourceIdSchema, ReviewDeveloperAccessSchema } from '@crewstation/contracts';
import type { UserId } from '@crewstation/contracts';
import { parseBody, parseParams, parseQuery, requireUser } from '@crewstation/http';
import type { AppEnv } from '@crewstation/http';
import { Hono } from 'hono';
import { z } from 'zod';
import type { IdentityModuleApi } from '../api/moduleApi';

export function developerAccessRoutes(api: IdentityModuleApi): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.get('/v1/me/developer-access', async c => c.json(await api.myDeveloperAccess(requireUser(c).userId as UserId)));
  routes.post('/v1/me/developer-access', async c => c.json(await api.requestDeveloperAccess(requireUser(c).userId as UserId, await parseBody(c, RequestDeveloperAccessSchema)), 201));
  routes.get('/v1/admin/developer-access', async c => c.json(await api.listDeveloperAccess(requireUser(c).userId as UserId, parseQuery(c, DeveloperAccessQuerySchema))));
  routes.post('/v1/admin/developer-access/:requestId/review', async c => c.json(await api.reviewDeveloperAccess(requireUser(c).userId as UserId, parseParams(c, z.object({ requestId: ResourceIdSchema })).requestId, await parseBody(c, ReviewDeveloperAccessSchema))));
  return routes;
}
