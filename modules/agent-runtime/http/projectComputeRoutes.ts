import type { ProjectId, UserId } from '@crewstation/contracts';
import { ProjectIdSchema, SaveProjectComputePolicySchema } from '@crewstation/contracts';
import { actorFrom, parseBody, parseParams } from '@crewstation/http';
import type { AppEnv } from '@crewstation/http';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AgentRuntimeModuleApi } from '../api/moduleApi';

export function projectComputeRoutes(api: AgentRuntimeModuleApi, isAdmin: (id: UserId) => Promise<boolean>): Hono<AppEnv> {
  const r = new Hono<AppEnv>(), params = z.object({ projectId: ProjectIdSchema });
  const actor = async (c: Parameters<typeof actorFrom>[0]) => { const a = await actorFrom(c, (id) => isAdmin(id as UserId)); return { userId: a.userId as UserId, isAdmin: a.isAdmin }; };
  const id = (c: Parameters<typeof parseParams>[0]) => parseParams(c, params).projectId as ProjectId;
  r.use('/v1/projects/:projectId/compute-*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next(); });
  r.get('/v1/projects/:projectId/compute-policy', async (c) => c.json(await api.getProjectComputePolicy(await actor(c), id(c))));
  r.put('/v1/projects/:projectId/compute-policy', async (c) => c.json(await api.saveProjectComputePolicy(await actor(c), id(c), await parseBody(c, SaveProjectComputePolicySchema))));
  r.get('/v1/projects/:projectId/compute-profiles', async (c) => c.json({ items: await api.listProjectSummaries(await actor(c), id(c)) }));
  return r;
}
