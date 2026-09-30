import type { UserId } from '@crewstation/contracts';
import { ProjectIdSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { actorFrom, parseParams } from '@crewstation/http';
import { Hono } from 'hono';
import { z } from 'zod';
import type { CapabilitiesModuleApi } from '../api/moduleApi';

export function projectResourceRoutes(api: Pick<CapabilitiesModuleApi, 'projectResources'>, isAdmin: (id: UserId) => Promise<boolean>) {
  const r = new Hono<AppEnv>();
  r.get('/v1/projects/:projectId/resource-center', async (c) => {
    c.header('Cache-Control', 'private, no-store'); const actor = await actorFrom(c, (id) => isAdmin(id as UserId));
    return c.json(await api.projectResources({ ...actor, userId: actor.userId as UserId }, parseParams(c, z.object({ projectId: ProjectIdSchema })).projectId));
  });
  return r;
}
