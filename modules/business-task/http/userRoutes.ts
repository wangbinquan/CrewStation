import type { ProjectId, TaskId, UserId } from '@crewstation/contracts';
import { BusinessExecutionTaskQuerySchema, ProjectIdSchema, TaskIdSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { actorFrom, parseBody, parseParams, parseQuery } from '@crewstation/http';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import type { BusinessTaskModuleApi } from '../api/moduleApi';
import { storageOperatorRoutes } from './storageOperatorRoutes';
import { recoveryAdminRoutes } from './recoveryAdminRoutes';

/** 工作台只读视图：项目成员查看业务任务与子任务。 */
export function userRoutes(api: BusinessTaskModuleApi, isAdmin: (userId: UserId) => Promise<boolean>): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.route('/', recoveryAdminRoutes(api, isAdmin));
  r.route('/', storageOperatorRoutes(api, isAdmin));
  const actor = async (c: Context<AppEnv>) => { const a = await actorFrom(c, (id) => isAdmin(id as UserId)); return { userId: a.userId as UserId, isAdmin: a.isAdmin }; };
  r.get('/v3/object-storage/tasks/:taskId', async (c) => c.json(await api.describeTaskStorage(await actor(c), parseParams(c, z.object({ taskId: TaskIdSchema })).taskId)));
  r.get('/v3/projects/:projectId/object-storage/tasks', async (c) => c.json(await api.listProjectTaskStorage(await actor(c), parseParams(c, z.object({ projectId: ProjectIdSchema })).projectId, parseQuery(c, BusinessExecutionTaskQuerySchema.omit({ projectId: true })))));
  r.get('/v1/projects/:projectId/business-tasks', async (c) => c.json({ items: await api.listProjectTasks(await actor(c), parseParams(c, z.object({ projectId: ProjectIdSchema })).projectId as ProjectId) }));
  r.get('/v1/projects/:projectId/business-tasks/:taskId/subtasks', async (c) => {
    const p = parseParams(c, z.object({ projectId: ProjectIdSchema, taskId: TaskIdSchema }));
    return c.json({ items: await api.listProjectSubtasks(await actor(c), p.projectId as ProjectId, p.taskId as TaskId) });
  });
  r.get('/v1/admin/business-execution/tasks', async (c) => c.json(await api.listExecutionTasks(await actor(c), parseQuery(c, BusinessExecutionTaskQuerySchema))));
  const legacy = z.strictObject({ identity: z.string().min(3).max(256) });
  r.get('/v1/admin/business-execution/legacy-recovery', async (c) => c.json(await api.legacyRecovery(await actor(c), parseQuery(c, legacy).identity, 'inspect')));
  r.post('/v1/admin/business-execution/legacy-recovery', async (c) => {
    const input = await parseBody(c, legacy.extend({ action: z.enum(['reconcile', 'stop']), ticketId: z.uuid().optional() }));
    return c.json(await api.legacyRecovery(await actor(c), input.identity, input.action, input.ticketId));
  });
  return r;
}
