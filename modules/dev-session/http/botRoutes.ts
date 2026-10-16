import type { UserId } from '@crewstation/contracts';
import { BotHistoryQuerySchema, FreshBotContextRequestSchema, InterruptBotRequestSchema, SendBotMessageRequestSchema, TaskIdSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { actorFrom, parseBody, parseParams, parseQuery } from '@crewstation/http';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { DevSessionModuleApi } from '../api/moduleApi';

export function botRoutes(api: DevSessionModuleApi, isAdmin: (userId: UserId) => Promise<boolean>): Hono<AppEnv> {
  const router = new Hono<AppEnv>(), params = z.object({ taskId: TaskIdSchema });
  const actor = async (c: Context<AppEnv>) => { const a = await actorFrom(c, (id) => isAdmin(id as UserId)); return { userId: a.userId as UserId, isAdmin: a.isAdmin }; };
  router.get('/v2/dev-sessions/:taskId/bot', async (c) => { c.header('cache-control', 'no-store'); return c.json(await api.getBot(await actor(c), parseParams(c, params).taskId)); });
  router.get('/v2/dev-sessions/:taskId/bot/history', async (c) => { c.header('cache-control', 'no-store'); return c.json(await api.botHistory(await actor(c), parseParams(c, params).taskId, parseQuery(c, BotHistoryQuerySchema))); });
  router.post('/v2/dev-sessions/:taskId/bot/messages', async (c) => c.json(await api.sendBotMessage(await actor(c), parseParams(c, params).taskId, await parseBody(c, SendBotMessageRequestSchema)), 202));
  router.post('/v2/dev-sessions/:taskId/bot/interrupt', async (c) => c.json(await api.interruptBot(await actor(c), parseParams(c, params).taskId, await parseBody(c, InterruptBotRequestSchema)), 202));
  router.post('/v2/dev-sessions/:taskId/bot/context', async (c) => c.json(await api.freshBotContext(await actor(c), parseParams(c, params).taskId, await parseBody(c, FreshBotContextRequestSchema)), 202));
  return router;
}
