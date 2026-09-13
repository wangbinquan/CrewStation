import type { UserId } from '@crewstation/contracts';
import { MarketAppsQuerySchema, ProjectIdSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { actorFrom, parseParams, parseQuery } from '@crewstation/http';
import { Hono } from 'hono';
import { z } from 'zod';
import type { CapabilitiesModuleApi } from '../api/moduleApi';

export function marketRoutes(api: CapabilitiesModuleApi, isAdmin: (userId: UserId) => Promise<boolean>): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.use('/v1/market/*', async (c, next) => { c.header('Cache-Control', 'private, no-store'); await next(); });
  r.get('/v1/market/apps', async (c) => {
    const actor = await actorFrom(c, (id) => isAdmin(id as UserId));
    return c.json(await api.listMarketApps({ ...actor, userId: actor.userId as UserId }, parseQuery(c, MarketAppsQuerySchema)));
  });
  r.get('/v1/market/apps/:projectId', async (c) => {
    const actor = await actorFrom(c, (id) => isAdmin(id as UserId));
    return c.json(await api.getMarketApp({ ...actor, userId: actor.userId as UserId }, parseParams(c, z.object({ projectId: ProjectIdSchema })).projectId));
  });
  return r;
}
