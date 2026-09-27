import { executionBody as body } from './executionBody';
import { BusinessSubtaskMessageV3Schema, BusinessMaterialRequestSchema } from '@crewstation/contracts';
import { BusinessTaskMutationSchema, RebuildBusinessTaskSchema, RestartBusinessTaskSchema, ResourceIdSchema } from '@crewstation/contracts';
import { executionStream } from './executionStream';
import { BusinessMigrationReadySchema, BusinessControlActivateSchema, BusinessControlClaimSchema, BusinessControlLeaseRequestSchema, BusinessHandoffReadySchema, CreateBusinessTaskV3Schema, TaskIdSchema } from '@crewstation/contracts';
import { BusinessDirectoryQuerySchema, BusinessFileQuerySchema, SubmitBusinessSubtaskV3Schema, SubtaskIdSchema, BusinessEventQuerySchema, BusinessSubtaskMutationSchema, RetryBusinessSubtaskV3Schema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { parseParams, parseQuery, requireService } from '@crewstation/http';
import { isPlatformError, validation } from '@crewstation/kernel';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { BusinessExecutionApi } from '../api/executionApi';

export function executionRoutes(api: BusinessExecutionApi): Hono<AppEnv> {
  const router = new Hono<AppEnv>();
  const caller = (c: Context<AppEnv>) => { const identity = requireService(c); return { identity: identity.identity, ...(identity.token ? { token: identity.token } : {}) }; };
  router.use('/v3/*', async (c, next) => {
    try { await next(); if (c.res.status === 429) c.header('Retry-After', '1'); } catch (error) { if (isPlatformError(error) && error.kind === 'quota_exceeded') c.header('Retry-After', '1'); throw error; }
  });
  router.get('/v3/business-execution/capabilities', async (c) => c.json(await api.capabilities(caller(c))));
  router.post('/v3/business-tasks', async (c) => { const result = await api.createTask(caller(c), await body(c, CreateBusinessTaskV3Schema), c.req.header('x-cs-trace-id')); return c.json(result.task, result.status); });
  router.get('/v3/business-tasks/:taskId', async (c) => c.json(await api.getTask(caller(c), parseParams(c, z.object({ taskId: TaskIdSchema })).taskId)));
  router.get('/v3/business-tasks/:taskId/file', async (c) => c.json(await api.readFile(caller(c), parseParams(c, z.object({ taskId: TaskIdSchema })).taskId, parseQuery(c, BusinessFileQuerySchema))));
  router.get('/v3/business-tasks/:taskId/files', async (c) => c.json(await api.listFiles(caller(c), parseParams(c, z.object({ taskId: TaskIdSchema })).taskId, parseQuery(c, BusinessDirectoryQuerySchema))));
  const taskParams = z.object({ taskId: TaskIdSchema }), subtaskParams = taskParams.extend({ subtaskId: SubtaskIdSchema });
  router.post('/v3/business-tasks/:taskId/materials', async (c) => c.json(await api.createMaterial(caller(c), parseParams(c, taskParams).taskId, await body(c, BusinessMaterialRequestSchema)), 201));
  for (const action of ['pause', 'resume', 'close'] as const) router.post(`/v3/business-tasks/:taskId/${action}`, async (c) => c.json(await api.mutateTask(caller(c), parseParams(c, taskParams).taskId, action, await body(c, BusinessTaskMutationSchema)), 202));
  router.post('/v3/business-tasks/:taskId/rebuild', async (c) => c.json(await api.mutateTask(caller(c), parseParams(c, taskParams).taskId, 'rebuild', await body(c, RebuildBusinessTaskSchema)), 202));
  router.post('/v3/business-tasks/:taskId/restart', async (c) => { const result = await api.restartTask(caller(c), parseParams(c, taskParams).taskId, await body(c, RestartBusinessTaskSchema)); return c.json(result.task, result.status); });
  router.get('/v3/business-tasks/:taskId/operations/:operationId', async (c) => { const p = parseParams(c, taskParams.extend({ operationId: ResourceIdSchema })); return c.json(await api.getOperation(caller(c), p.taskId, p.operationId)); });
  router.post('/v3/business-tasks/:taskId/subtasks', async (c) => { const result = await api.submitSubtask(caller(c), parseParams(c, taskParams).taskId, await body(c, SubmitBusinessSubtaskV3Schema)); return c.json(result.subtask, result.status); });
  router.get('/v3/business-tasks/:taskId/subtasks', async (c) => c.json({ items: await api.listSubtasks(caller(c), parseParams(c, taskParams).taskId) }));
  router.get('/v3/business-tasks/:taskId/subtasks/:subtaskId', async (c) => { const p = parseParams(c, subtaskParams); return c.json(await api.getSubtask(caller(c), p.taskId, p.subtaskId)); });
  router.get('/v3/business-tasks/:taskId/events/stream', async (c) => executionStream(c, api, caller(c), parseParams(c, taskParams).taskId, parseQuery(c, BusinessEventQuerySchema)));
  router.get('/v3/business-tasks/:taskId/events', async (c) => c.json(await api.events(caller(c), parseParams(c, taskParams).taskId, parseQuery(c, BusinessEventQuerySchema))));
  router.get('/v3/business-tasks/:taskId/subtasks/:subtaskId/output', async (c) => { const p = parseParams(c, subtaskParams); return c.json(await api.output(caller(c), p.taskId, p.subtaskId)); });
  router.post('/v3/business-tasks/:taskId/subtasks/:subtaskId/cancel', async (c) => { const p = parseParams(c, subtaskParams); return c.json(await api.cancelSubtask(caller(c), p.taskId, p.subtaskId, await body(c, BusinessSubtaskMutationSchema)), 202); });
  router.post('/v3/business-tasks/:taskId/subtasks/:subtaskId/messages', async (c) => { const p = parseParams(c, subtaskParams); return c.json(await api.sendMessage(caller(c), p.taskId, p.subtaskId, await body(c, BusinessSubtaskMessageV3Schema)), 202); });
  router.post('/v3/business-tasks/:taskId/subtasks/:subtaskId/retry', async (c) => { const p = parseParams(c, subtaskParams), result = await api.retrySubtask(caller(c), p.taskId, p.subtaskId, await body(c, RetryBusinessSubtaskV3Schema)); return c.json(result.subtask, result.status); });
  const root = '/v3/business-execution/control';
  router.get(root, async (c) => c.json(await api.control(caller(c))));
  router.post(`${root}/claim`, async (c) => c.json(await api.claim(caller(c), await body(c, BusinessControlClaimSchema))));
  router.post(`${root}/renew`, async (c) => c.json(await api.renew(caller(c), await body(c, BusinessControlLeaseRequestSchema))));
  router.post(`${root}/release`, async (c) => c.json(await api.release(caller(c), await body(c, BusinessControlLeaseRequestSchema))));
  router.post(`${root}/activate`, async (c) => c.json(await api.activate(caller(c), await body(c, BusinessControlActivateSchema))));
  router.post(`${root}/handoffs/:operationId/ready`, async (c) => {
    const input = await body(c, BusinessHandoffReadySchema);
    if (input.operationId !== c.req.param('operationId')) throw validation('路径与请求中的交接操作 ID 不一致');
    return c.json(await api.handoffReady(caller(c), input));
  });
  router.post(`${root}/migrations/:operationId/ready`, async (c) => {
    const input = await body(c, BusinessMigrationReadySchema);
    if (input.operationId !== c.req.param('operationId')) throw validation('路径与请求中的迁移操作 ID 不一致');
    return c.json(await api.migrationReady(caller(c), input));
  });
  return router;
}
