import type { UserId } from '@crewstation/contracts';
import { ProjectIdSchema, SaveProjectRuntimeImagePolicySchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { actorFrom, parseBody, parseParams } from '@crewstation/http';
import { Hono } from 'hono';
import { z } from 'zod';
import type { RuntimeEnvironmentModuleApi } from '../api/moduleApi';

export function projectImagePolicyRoutes(api: RuntimeEnvironmentModuleApi, isAdmin: (id: UserId) => Promise<boolean>) {
  const r = new Hono<AppEnv>(), root = '/v1/projects/:projectId/runtime-image-policy', params = z.object({ projectId: ProjectIdSchema });
  r.use(root, async (c, next) => { c.header('Cache-Control', 'no-store'); await next(); });
  r.get('/v1/projects/:projectId/runtime-image-policy', async (c) => {
    const actor = await actorFrom(c, (id) => isAdmin(id as UserId));
    return c.json(await api.getProjectImagePolicy({ ...actor, userId: actor.userId as UserId }, parseParams(c, params).projectId));
  });
  r.put('/v1/projects/:projectId/runtime-image-policy', async (c) => {
    const actor = await actorFrom(c, (id) => isAdmin(id as UserId));
    return c.json(await api.saveProjectImagePolicy({ ...actor, userId: actor.userId as UserId }, parseParams(c, params).projectId, await parseBody(c, SaveProjectRuntimeImagePolicySchema)));
  });
  return r;
}
