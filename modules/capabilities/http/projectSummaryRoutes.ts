import type { UserId } from '@crewstation/contracts';
import { ProjectIdSchema, ProjectPageQuerySchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { actorFrom, parseParams, parseQuery } from '@crewstation/http';
import { Hono } from 'hono';
import { z } from 'zod';
import type { CapabilitiesModuleApi } from '../api/moduleApi';

export function projectSummaryRoutes(api: Pick<CapabilitiesModuleApi, 'listProjectSummaries' | 'getProjectSummary'>, isAdmin: (id: UserId) => Promise<boolean>): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.use('/v1/workbench/project-summaries/*', async (c, next) => { c.header('Cache-Control', 'private, no-store'); await next(); });
  r.get('/v1/workbench/project-summaries', async (c) => {
    const actor = await actorFrom(c, (id) => isAdmin(id as UserId));
    return c.json(await api.listProjectSummaries({ ...actor, userId: actor.userId as UserId }, parseQuery(c, ProjectPageQuerySchema)));
  });
  r.get('/v1/workbench/project-summaries/:projectId', async (c) => {
    const actor = await actorFrom(c, (id) => isAdmin(id as UserId));
    return c.json(await api.getProjectSummary({ ...actor, userId: actor.userId as UserId }, parseParams(c, z.object({ projectId: ProjectIdSchema })).projectId));
  });
  return r;
}
