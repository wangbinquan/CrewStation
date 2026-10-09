import type { UserId } from '@crewstation/contracts';
import { ReleaseIdSchema, ReleaseJourneyPageRequestSchema, ResourceIdSchema, ServiceIdSchema, VerifyReleaseJourneyRequestSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { parseBody, parseParams, parseQuery, requireUser } from '@crewstation/http';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { ReleaseModuleApi } from '../api/moduleApi';

export function journeyRoutes(api: ReleaseModuleApi, isAdmin: (id: UserId) => Promise<boolean>): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  const actor = async (c: Context<AppEnv>) => { const userId = requireUser(c).userId as UserId; return { userId, isAdmin: await isAdmin(userId) }; };
  const journeyParams = z.object({ journeyId: ResourceIdSchema });
  routes.get('/v1/services/:serviceId/release-journeys', async (c) => c.json(await api.listJourneys(await actor(c), parseParams(c, z.object({ serviceId: ServiceIdSchema })).serviceId, parseQuery(c, ReleaseJourneyPageRequestSchema))));
  routes.get('/v1/release-journeys/:journeyId', async (c) => c.json(await api.getJourney(await actor(c), parseParams(c, journeyParams).journeyId)));
  routes.get('/v1/releases/:releaseId/journey-history', async (c) => c.json(await api.journeyHistory(await actor(c), parseParams(c, z.object({ releaseId: ReleaseIdSchema })).releaseId)));
  routes.post('/v1/release-journeys/:journeyId/verification', async (c) => c.json(await api.verifyJourney(await actor(c), parseParams(c, journeyParams).journeyId, await parseBody(c, VerifyReleaseJourneyRequestSchema))));
  return routes;
}
