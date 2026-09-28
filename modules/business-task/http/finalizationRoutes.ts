import { FinalizeBusinessTaskSchema, ReviseBusinessArchiveSchema, TaskIdSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { parseParams, requireService } from '@crewstation/http';
import { Hono } from 'hono';
import { z } from 'zod';
import type { BusinessExecutionApi } from '../api/executionApi';
import { executionBody } from './executionBody';

export function finalizationRoutes(api: Pick<BusinessExecutionApi, 'finalize' | 'finalization' | 'reviseArchive'>): Hono<AppEnv> {
  const router = new Hono<AppEnv>(), task = z.object({ taskId: TaskIdSchema });
  router.post('/v3/business-tasks/:taskId/finalize', async (c) => c.json(await api.finalize(requireService(c), parseParams(c, task).taskId, await executionBody(c, FinalizeBusinessTaskSchema)), 202));
  router.get('/v3/business-tasks/:taskId/finalization', async (c) => c.json(await api.finalization(requireService(c), parseParams(c, task).taskId)));
  router.post('/v3/business-tasks/:taskId/finalization/archive', async (c) => c.json(await api.reviseArchive(requireService(c), parseParams(c, task).taskId, await executionBody(c, ReviseBusinessArchiveSchema)), 202));
  return router;
}
