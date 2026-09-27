import type { UserId } from '@crewstation/contracts';
import { RequestBusinessRecoverySchema, SubtaskIdSchema, TaskIdSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { actorFrom, parseBody, parseParams, parseQuery } from '@crewstation/http';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { BusinessTaskRecoveryApi } from '../api/taskRecovery';

export function recoveryAdminRoutes(api: BusinessTaskRecoveryApi, isAdmin: (userId: UserId) => Promise<boolean>): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  const actor = async (c: Context<AppEnv>) => { const a = await actorFrom(c, (id) => isAdmin(id as UserId)); return { userId: a.userId as UserId, isAdmin: a.isAdmin }; };
  const taskId = (c: Context<AppEnv>) => parseParams(c, z.object({ taskId: TaskIdSchema })).taskId;
  routes.get('/v1/admin/business-execution/tasks/:taskId', async (c) => c.json(await api.describeRecoveryTask(await actor(c), taskId(c))));
  routes.get('/v1/admin/business-execution/tasks/:taskId/recovery', async (c) => c.json(await api.assessTaskRecovery(await actor(c), taskId(c), parseQuery(c, z.strictObject({ subtaskId: SubtaskIdSchema.optional() })).subtaskId)));
  routes.get('/v1/admin/business-execution/tasks/:taskId/recovery/requests', async (c) => c.json({ items: await api.listTaskRecoveries(await actor(c), taskId(c)) }));
  routes.post('/v1/admin/business-execution/tasks/:taskId/recovery', async (c) => c.json(await api.requestTaskRecovery(await actor(c), taskId(c), await parseBody(c, RequestBusinessRecoverySchema)), 202));
  return routes;
}
