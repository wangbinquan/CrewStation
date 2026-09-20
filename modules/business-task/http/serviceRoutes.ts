import type { ServiceActor, SubtaskId, TaskId } from '@crewstation/contracts';
import { CreateBusinessTaskRequestSchema, SubmitSubtaskRequestSchema, SubtaskIdSchema, SubtaskMessageRequestSchema, TaskIdSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { parseBody, parseParams, requireService } from '@crewstation/http';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import type { BusinessTaskModuleApi } from '../api/moduleApi';

const taskParams = z.object({ taskId: TaskIdSchema });
const subtaskParams = z.object({ taskId: TaskIdSchema, subtaskId: SubtaskIdSchema });

/** 业务服务经服务域调用；调用方身份由网关按源 Pod IP 注入（R09）。 */
export function serviceRoutes(api: BusinessTaskModuleApi): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const caller = (c: Context<AppEnv>): ServiceActor => { const s = requireService(c); return { identity: s.identity, project: s.project, service: s.service, ...(s.slot ? { slot: s.slot } : {}) }; };
  const ids = (c: Context<AppEnv>) => { const p = parseParams(c, subtaskParams); return { taskId: p.taskId as TaskId, subtaskId: p.subtaskId as SubtaskId }; };
  r.post('/v2/business-tasks', async (c) => c.json(await api.createTask(caller(c), await parseBody(c, CreateBusinessTaskRequestSchema)), 201));
  r.get('/v2/business-tasks/:taskId', async (c) => c.json(await api.getTask(caller(c), parseParams(c, taskParams).taskId as TaskId)));
  r.post('/v2/business-tasks/:taskId/close', async (c) => c.json(await api.closeTask(caller(c), parseParams(c, taskParams).taskId as TaskId)));
  r.post('/v2/business-tasks/:taskId/pause', async (c) => c.json(await api.pauseTask(caller(c), parseParams(c, taskParams).taskId as TaskId)));
  r.post('/v2/business-tasks/:taskId/resume', async (c) => c.json(await api.resumeTask(caller(c), parseParams(c, taskParams).taskId as TaskId)));
  r.post('/v2/business-tasks/:taskId/subtasks', async (c) => c.json(await api.submitSubtask(caller(c), parseParams(c, taskParams).taskId as TaskId, await parseBody(c, SubmitSubtaskRequestSchema)), 201));
  r.get('/v2/business-tasks/:taskId/subtasks', async (c) => c.json({ items: await api.listSubtasks(caller(c), parseParams(c, taskParams).taskId as TaskId) }));
  r.get('/v2/business-tasks/:taskId/subtasks/:subtaskId', async (c) => { const { taskId, subtaskId } = ids(c); return c.json(await api.getSubtask(caller(c), taskId, subtaskId)); });
  r.get('/v2/business-tasks/:taskId/subtasks/:subtaskId/output', async (c) => { const { taskId, subtaskId } = ids(c); return c.text(await api.subtaskOutput(caller(c), taskId, subtaskId)); });
  r.post('/v2/business-tasks/:taskId/subtasks/:subtaskId/messages', async (c) => { const { taskId, subtaskId } = ids(c); return c.json(await api.sendSubtaskMessage(caller(c), taskId, subtaskId, await parseBody(c, SubtaskMessageRequestSchema))); });
  r.post('/v2/business-tasks/:taskId/subtasks/:subtaskId/cancel', async (c) => { const { taskId, subtaskId } = ids(c); return c.json(await api.cancelSubtask(caller(c), taskId, subtaskId)); });
  r.post('/v2/business-tasks/:taskId/subtasks/:subtaskId/retry', async (c) => { const { taskId, subtaskId } = ids(c); return c.json(await api.retrySubtask(caller(c), taskId, subtaskId), 201); });
  return r;
}
