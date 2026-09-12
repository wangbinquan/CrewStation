import type { ProjectId, ServiceId, UserId } from '@crewstation/contracts';
import { CreateProjectRequestSchema, ListProjectsQuerySchema, ProjectIdSchema, ServiceIdSchema, SetMemberRequestSchema, SetQuotaRequestSchema, UserIdSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { parseBody, parseParams, parseQuery } from '@crewstation/http';
import { Hono } from 'hono';
import { z } from 'zod';
import type { ProjectModuleApi } from '../api/moduleApi';
import { actorFrom } from './actor';

const projectParams = z.object({ projectId: ProjectIdSchema });

export function projectRoutes(api: ProjectModuleApi): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.get('/v1/projects', async (c) => c.json({ items: await api.listProjects(await actorFrom(c, api), parseQuery(c, ListProjectsQuerySchema)) }));
  r.post('/v1/projects', async (c) => c.json(await api.createProject(await actorFrom(c, api), await parseBody(c, CreateProjectRequestSchema)), 201));
  r.get('/v1/projects/:projectId', async (c) => c.json(await api.getProject(await actorFrom(c, api), parseParams(c, projectParams).projectId as ProjectId)));
  r.post('/v1/projects/:projectId/archive', async (c) => c.json(await api.archiveProject(await actorFrom(c, api), parseParams(c, projectParams).projectId as ProjectId)));
  r.get('/v1/projects/:projectId/members', async (c) => c.json({ items: await api.listMembers(await actorFrom(c, api), parseParams(c, projectParams).projectId as ProjectId) }));
  r.put('/v1/projects/:projectId/members', async (c) => c.json(await api.setMember(await actorFrom(c, api), parseParams(c, projectParams).projectId as ProjectId, await parseBody(c, SetMemberRequestSchema))));
  r.delete('/v1/projects/:projectId/members/:userId', async (c) => {
    const { projectId, userId } = parseParams(c, projectParams.extend({ userId: UserIdSchema }));
    await api.removeMember(await actorFrom(c, api), projectId as ProjectId, userId as UserId);
    return c.body(null, 204);
  });
  r.get('/v1/projects/:projectId/quota', async (c) => c.json(await api.getQuota(await actorFrom(c, api), parseParams(c, projectParams).projectId as ProjectId)));
  r.put('/v1/projects/:projectId/quota', async (c) => c.json(await api.setQuota(await actorFrom(c, api), parseParams(c, projectParams).projectId as ProjectId, await parseBody(c, SetQuotaRequestSchema))));
  r.get('/v1/services/:serviceId', async (c) => c.json(await api.getService(await actorFrom(c, api), parseParams(c, z.object({ serviceId: ServiceIdSchema })).serviceId as ServiceId)));
  return r;
}
