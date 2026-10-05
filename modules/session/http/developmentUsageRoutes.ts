import { DevelopmentUsageDrainReasonSchema, DevelopmentUsageKeySchema, DevelopmentUsageLossSchema, DevelopmentUsageRegistrationSchema, TaskIdSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { parseBody, parseParams } from '@crewstation/http';
import { notFound, precondition } from '@crewstation/kernel';
import { Hono } from 'hono';
import { z } from 'zod';
import type { SessionUseCaseDeps } from '../application/dependencies';

/** Owner-only internal control; never exposes prompt/credentials or browser ACK commands. */
export function developmentUsageRoutes(deps: Pick<SessionUseCaseDeps, 'developmentUsage'>): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const store = () => { if (!deps.developmentUsage) throw precondition('开发数字存储未启用'); return deps.developmentUsage; };
  r.get('/internal/tasks/:taskId/development-usage/registration', async (c) => c.json(await store().lookup(parseParams(c, z.object({ taskId: TaskIdSchema })).taskId)));
  r.post('/internal/development-usage/register', async (c) => c.json(await store().register(await parseBody(c, DevelopmentUsageRegistrationSchema))));
  r.post('/internal/tasks/:taskId/development-usage/read', async (c) => {
    const input = await parseBody(c, DevelopmentUsageKeySchema);
    const found = await store().get(TaskIdSchema.parse(c.req.param('taskId')), input);
    if (!found) throw notFound('开发数字副本', input.executionId);
    return c.json(found);
  });
  r.post('/internal/tasks/:taskId/development-usage/native-page', async (c) => {
    const input = await parseBody(c, z.strictObject({ key: DevelopmentUsageKeySchema, passId: z.string().min(1).max(512), ordinal: z.string().regex(/^(0|[1-9][0-9]*)$/) }));
    if (input.key.executionId !== TaskIdSchema.parse(c.req.param('taskId'))) throw notFound('原生页副本', input.key.executionId);
    const found = await store().nativePage(input.key, input.passId, input.ordinal);
    if (!found) throw notFound('原生页副本', input.passId);
    return c.json(found);
  });
  r.post('/internal/tasks/:taskId/development-usage/drain', async (c) => {
    const input = await parseBody(c, z.strictObject({ key: DevelopmentUsageKeySchema, reason: DevelopmentUsageDrainReasonSchema }));
    return c.json(await store().requestDrain(TaskIdSchema.parse(c.req.param('taskId')), input.key, input.reason));
  });
  r.post('/internal/tasks/:taskId/development-usage/unavailable', async (c) => c.json(await store().unavailable(TaskIdSchema.parse(c.req.param('taskId')), await parseBody(c, DevelopmentUsageLossSchema))));
  return r;
}
