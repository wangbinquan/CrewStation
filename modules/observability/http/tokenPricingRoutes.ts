import { ResourceIdSchema, SaveTokenPriceSchema, TokenPricePageQuerySchema } from '@crewstation/contracts';
import type { Actor, UserId } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { actorFrom, parseBody, parseParams, parseQuery } from '@crewstation/http';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import type { TokenPricingApi } from '../api/tokenPricingApi';

export function tokenPricingRoutes(api: TokenPricingApi, isAdmin: (id: UserId) => Promise<boolean>): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  const actor = async (c: Context<AppEnv>): Promise<Actor> => {
    const user = await actorFrom(c, (id) => isAdmin(id as UserId));
    return { userId: user.userId as UserId, isAdmin: user.isAdmin };
  };
  const profileId = (c: Context<AppEnv>) => parseParams(c, z.object({ profileId: ResourceIdSchema })).profileId;
  routes.get('/v1/admin/observability/pricing/profiles', async (c) => c.json(await api.pricingProfiles(await actor(c))));
  routes.get('/v1/admin/observability/pricing/profiles/:profileId/versions', async (c) => c.json(await api.priceHistory(await actor(c), profileId(c), parseQuery(c, TokenPricePageQuerySchema))));
  routes.post('/v1/admin/observability/pricing/profiles/:profileId/versions', async (c) => c.json(await api.savePrice(await actor(c), profileId(c), await parseBody(c, SaveTokenPriceSchema)), 201));
  return routes;
}
