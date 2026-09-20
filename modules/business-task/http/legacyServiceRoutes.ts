import type { ServiceActor } from '@crewstation/contracts';
import { LegacyCreateBusinessTaskRequestSchema, LegacySubmitSubtaskRequestSchema, SubtaskMessageRequestSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { parseBody, requireService } from '@crewstation/http';
import { Hono, type Context } from 'hono';
import type { BusinessTaskModuleApi } from '../api/moduleApi';
import type { LegacyBusinessProjection } from '../api/moduleApi';

/** Frozen v1 applications retain an explicit protocol adapter during the UUID rollout. */
export function legacyServiceRoutes(api: BusinessTaskModuleApi, legacy: LegacyBusinessProjection): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const caller = (c: Context<AppEnv>): ServiceActor => { const service = requireService(c); return { ...service }; };
  const task = async (c: Context<AppEnv>) => {
    const actor = caller(c), id = await legacy.taskId(c.req.param('taskId')!);
    return { actor, id, serviceId: (await api.getTask(actor, id)).serviceId };
  };
  const subtask = async (c: Context<AppEnv>) => ({ ...await task(c), subtaskId: await legacy.subtaskId(c.req.param('subtaskId')!) });
  r.post('/v1/business-tasks', async (c) => c.json(await legacy.task(await api.createTask(caller(c), await legacy.inputTask(await parseBody(c, LegacyCreateBusinessTaskRequestSchema)))), 201));
  r.get('/v1/business-tasks/:taskId', async (c) => { const { actor, id } = await task(c); return c.json(await legacy.task(await api.getTask(actor, id))); });
  for (const action of ['close', 'pause', 'resume'] as const) r.post(`/v1/business-tasks/:taskId/${action}`, async (c) => {
    const { actor, id } = await task(c);
    return c.json(await legacy.task(await api[`${action}Task`](actor, id)));
  });
  r.post('/v1/business-tasks/:taskId/subtasks', async (c) => {
    const { actor, id, serviceId } = await task(c);
    const input = await legacy.inputSubtask(await parseBody(c, LegacySubmitSubtaskRequestSchema), serviceId);
    return c.json(await legacy.subtask(await api.submitSubtask(actor, id, input), serviceId), 201);
  });
  r.get('/v1/business-tasks/:taskId/subtasks', async (c) => { const { actor, id, serviceId } = await task(c); return c.json({ items: await Promise.all((await api.listSubtasks(actor, id)).map((run) => legacy.subtask(run, serviceId))) }); });
  r.get('/v1/business-tasks/:taskId/subtasks/:subtaskId', async (c) => { const { actor, id, subtaskId, serviceId } = await subtask(c); return c.json(await legacy.subtask(await api.getSubtask(actor, id, subtaskId), serviceId)); });
  r.get('/v1/business-tasks/:taskId/subtasks/:subtaskId/output', async (c) => { const { actor, id, subtaskId } = await subtask(c); return c.text(await api.subtaskOutput(actor, id, subtaskId)); });
  r.post('/v1/business-tasks/:taskId/subtasks/:subtaskId/messages', async (c) => { const { actor, id, subtaskId, serviceId } = await subtask(c); return c.json(await legacy.subtask(await api.sendSubtaskMessage(actor, id, subtaskId, await parseBody(c, SubtaskMessageRequestSchema)), serviceId)); });
  r.post('/v1/business-tasks/:taskId/subtasks/:subtaskId/cancel', async (c) => { const { actor, id, subtaskId, serviceId } = await subtask(c); return c.json(await legacy.subtask(await api.cancelSubtask(actor, id, subtaskId), serviceId)); });
  r.post('/v1/business-tasks/:taskId/subtasks/:subtaskId/retry', async (c) => { const { actor, id, subtaskId, serviceId } = await subtask(c); return c.json(await legacy.subtask(await api.retrySubtask(actor, id, subtaskId), serviceId), 201); });
  return r;
}
