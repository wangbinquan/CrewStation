import type { ProjectId, UserId } from '@crewstation/contracts';
import { ProjectIdSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { actorFrom, parseParams } from '@crewstation/http';
import { Hono } from 'hono';
import { z } from 'zod';
import type { CapabilitiesModuleApi } from '../api/moduleApi';

export function capabilityRoutes(api: CapabilitiesModuleApi, isAdmin: (userId: UserId) => Promise<boolean>): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.get('/v1/projects/:projectId/capabilities', async (c) => {
    const actor = await actorFrom(c, (id) => isAdmin(id as UserId));
    return c.json(await api.describe({ userId: actor.userId as UserId, isAdmin: actor.isAdmin }, parseParams(c, z.object({ projectId: ProjectIdSchema })).projectId as ProjectId));
  });
  return r;
}
