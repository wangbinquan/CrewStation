import { MemberCandidatesQuerySchema, ProjectIdSchema, SetAppPresentationRequestSchema, SetAppVisibilityRequestSchema, UserIdSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { parseBody, parseParams, parseQuery } from '@crewstation/http';
import { Hono } from 'hono';
import { z } from 'zod';
import type { ProjectModuleApi } from '../api/moduleApi';
import { actorFrom } from './actor';

export function appListingRoutes(api: ProjectModuleApi): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const params = z.object({ projectId: ProjectIdSchema });
  r.get('/v1/projects/:projectId/app-visibility', async (c) => c.json(await api.getAppVisibility(await actorFrom(c, api), parseParams(c, params).projectId)));
  r.put('/v1/projects/:projectId/app-visibility', async (c) => c.json(await api.setAppVisibility(await actorFrom(c, api), parseParams(c, params).projectId, await parseBody(c, SetAppVisibilityRequestSchema))));
  r.get('/v1/projects/:projectId/app-visibility/check', async (c) => c.json(await api.checkAppVisibility(await actorFrom(c, api), parseParams(c, params).projectId, parseQuery(c, z.object({ userId: UserIdSchema })).userId)));
  r.get('/v1/projects/:projectId/app-presentation', async (c) => c.json(await api.getAppPresentation(await actorFrom(c, api), parseParams(c, params).projectId)));
  r.put('/v1/projects/:projectId/app-presentation', async (c) => c.json(await api.setAppPresentation(await actorFrom(c, api), parseParams(c, params).projectId, await parseBody(c, SetAppPresentationRequestSchema))));
  r.get('/v1/projects/:projectId/member-candidates', async (c) => c.json({ items: await api.memberCandidates(await actorFrom(c, api), parseParams(c, params).projectId, parseQuery(c, MemberCandidatesQuerySchema).identity) }));
  return r;
}
