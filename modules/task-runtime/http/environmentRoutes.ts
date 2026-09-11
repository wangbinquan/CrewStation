import type { ProjectId, TaskId, UserId } from '@crewstation/contracts';
import { ProjectIdSchema, TaskIdSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { actorFrom, parseParams, parseQuery } from '@crewstation/http';
import { Hono } from 'hono';
import { z } from 'zod';
import type { TaskRuntimeModuleApi } from '../api/moduleApi';

const stateSchema = z.enum(['creating', 'running', 'paused', 'releasing', 'released', 'failed']);

/** 只读视图；创建与释放由 dev-session、business-task 的路由承担。 */
export function environmentRoutes(api: TaskRuntimeModuleApi, isAdmin: (userId: UserId) => Promise<boolean>): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const actor = (c: Parameters<typeof actorFrom>[0]) => actorFrom(c, (id) => isAdmin(id as UserId)).then((a) => ({ userId: a.userId as UserId, isAdmin: a.isAdmin }));
  r.get('/v1/projects/:projectId/tasks', async (c) => {
    const { projectId } = parseParams(c, z.object({ projectId: ProjectIdSchema }));
    const { state } = parseQuery(c, z.object({ state: stateSchema.optional() }));
    return c.json({ items: await api.listEnvironments(await actor(c), projectId as ProjectId, state ? [state] : undefined) });
  });
  r.get('/v1/tasks/:taskId', async (c) => c.json(await api.describeEnvironment(await actor(c), parseParams(c, z.object({ taskId: TaskIdSchema })).taskId as TaskId)));
  return r;
}
