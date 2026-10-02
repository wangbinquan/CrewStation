import { AcceptProjectDeletionSchema, ProjectDeletionLookupSchema, ProjectIdSchema, ResourceIdSchema } from '@crewstation/contracts';
import type { Actor, UserId } from '@crewstation/contracts';
import { actorFrom, parseBody, parseParams } from '@crewstation/http';
import type { AppEnv } from '@crewstation/http';
import { forbidden } from '@crewstation/kernel';
import { Hono } from 'hono';
import { z } from 'zod';
import type { ProjectDeletionController } from '../api/deletion';

export function projectDeletionRoutes(api: ProjectDeletionController, isAdmin: (id: UserId) => Promise<boolean>): Hono<AppEnv> {
  const r = new Hono<AppEnv>(), projectParams = z.object({ projectId: ProjectIdSchema }), operationParams = z.object({ operationId: ResourceIdSchema });
  const actor = async (c: Parameters<typeof actorFrom>[0]): Promise<Actor> => {
    const result = await actorFrom(c, (id) => isAdmin(id as UserId));
    if (!result.isAdmin) throw forbidden('只有管理员可以永久删除项目或读取清理材料');
    c.header('cache-control', 'no-store'); return { ...result, userId: result.userId as UserId };
  };
  r.post('/v1/projects/:projectId/deletion-plans', async (c) => {
    const user = await actor(c); await parseBody(c, z.object({}).strict());
    return c.json(await api.prepare(user, parseParams(c, projectParams).projectId));
  });
  r.post('/v1/projects/:projectId/deletions', async (c) => {
    const user = await actor(c), input = await parseBody(c, AcceptProjectDeletionSchema);
    const operation = await api.accept(user, parseParams(c, projectParams).projectId, input);
    c.header('location', `/v1/project-deletions/${operation.id}`); return c.json(operation, 202);
  });
  r.get('/v1/project-deletions/:operationId', async (c) => {
    const user = await actor(c); return c.json(await api.read(user, parseParams(c, operationParams).operationId));
  });
  r.get('/v1/projects/:projectId/deletion-operation', async (c) => {
    const user = await actor(c), { projectId } = parseParams(c, projectParams);
    return c.json(ProjectDeletionLookupSchema.parse({ projectId, operation: await api.find(user, projectId) ?? null }));
  });
  r.post('/v1/project-deletions/:operationId/retry', async (c) => {
    const user = await actor(c); await parseBody(c, z.object({}).strict());
    const operation = await api.retry(user, parseParams(c, operationParams).operationId);
    c.header('location', `/v1/project-deletions/${operation.id}`); return c.json(operation, 202);
  });
  r.post('/v1/project-deletions/:operationId/reconfirmation-plans', async (c) => {
    const user = await actor(c); await parseBody(c, z.object({}).strict());
    return c.json(await api.prepareReconfirmation(user, parseParams(c, operationParams).operationId));
  });
  r.post('/v1/project-deletions/:operationId/reconfirm', async (c) => {
    const user = await actor(c), input = await parseBody(c, AcceptProjectDeletionSchema);
    const operation = await api.reconfirm(user, parseParams(c, operationParams).operationId, input);
    c.header('location', `/v1/project-deletions/${operation.id}`); return c.json(operation, 202);
  });
  return r;
}
