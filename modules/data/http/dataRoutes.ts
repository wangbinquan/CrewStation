import type { ProjectId, ServiceId, TaskId, UserId } from '@crewstation/contracts';
import { DecideTaskDataBindingSchema, ProjectIdSchema, RequestTaskDataBindingSchema, ServiceIdSchema, TaskDataBindingStateSchema, TaskIdSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { parseBody, parseParams, parseQuery, requireUser } from '@crewstation/http';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import type { DataModuleApi } from '../api/moduleApi';

export function dataRoutes(api: DataModuleApi, isAdmin: (userId: UserId) => Promise<boolean>): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const actor = async (c: Context<AppEnv>) => {
    const user = requireUser(c);
    return { userId: user.userId as UserId, isAdmin: await isAdmin(user.userId as UserId) };
  };
  r.get('/v1/projects/:projectId/data/resources', async (c) => c.json({ items: await api.listResources(await actor(c), parseParams(c, z.object({ projectId: ProjectIdSchema })).projectId as ProjectId) }));
  r.get('/v1/projects/:projectId/data-bindings', async (c) => {
    const { projectId } = parseParams(c, z.object({ projectId: ProjectIdSchema }));
    const { state } = parseQuery(c, z.object({ state: TaskDataBindingStateSchema.optional() }));
    return c.json({ items: await api.listProjectBindings(await actor(c), projectId as ProjectId, state ? [state] : undefined) });
  });
  r.post('/v1/services/:serviceId/tasks/:taskId/data-bindings', async (c) => {
    const { serviceId, taskId } = parseParams(c, z.object({ serviceId: ServiceIdSchema, taskId: TaskIdSchema }));
    return c.json(await api.requestTaskBinding(await actor(c), { taskId: taskId as TaskId, serviceId: serviceId as ServiceId }, await parseBody(c, RequestTaskDataBindingSchema)), 201);
  });
  r.get('/v1/tasks/:taskId/data-bindings', async (c) => c.json({ items: await api.listTaskBindings(await actor(c), parseParams(c, z.object({ taskId: TaskIdSchema })).taskId as TaskId) }));
  r.post('/v1/data-bindings/:id/decision', async (c) => c.json(await api.decideTaskBinding(await actor(c), c.req.param('id'), await parseBody(c, DecideTaskDataBindingSchema))));
  r.post('/v1/data-bindings/:id/revoke', async (c) => c.json(await api.revokeTaskBinding(await actor(c), c.req.param('id'))));
  return r;
}
