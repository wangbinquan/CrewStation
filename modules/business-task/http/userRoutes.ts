import type { ProjectId, TaskId, UserId } from '@crewstation/contracts';
import { ProjectIdSchema, TaskIdSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { actorFrom, parseParams } from '@crewstation/http';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import type { BusinessTaskModuleApi } from '../api/moduleApi';

/** 工作台只读视图：项目成员查看业务任务与子任务。 */
export function userRoutes(api: BusinessTaskModuleApi, isAdmin: (userId: UserId) => Promise<boolean>): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const actor = async (c: Context<AppEnv>) => { const a = await actorFrom(c, (id) => isAdmin(id as UserId)); return { userId: a.userId as UserId, isAdmin: a.isAdmin }; };
  r.get('/v1/projects/:projectId/business-tasks', async (c) => c.json({ items: await api.listProjectTasks(await actor(c), parseParams(c, z.object({ projectId: ProjectIdSchema })).projectId as ProjectId) }));
  r.get('/v1/projects/:projectId/business-tasks/:taskId/subtasks', async (c) => {
    const p = parseParams(c, z.object({ projectId: ProjectIdSchema, taskId: TaskIdSchema }));
    return c.json({ items: await api.listProjectSubtasks(await actor(c), p.projectId as ProjectId, p.taskId as TaskId) });
  });
  return r;
}
