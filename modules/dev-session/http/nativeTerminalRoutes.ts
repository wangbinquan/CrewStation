import type { TaskId, UserId } from '@crewstation/contracts';
import { StartNativeTerminalRequestSchema, TaskIdSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { actorFrom, parseBody, parseParams } from '@crewstation/http';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { NativeTerminalApi } from '../api/nativeTerminalApi';

export function nativeTerminalRoutes(api: NativeTerminalApi, isAdmin: (id: UserId) => Promise<boolean>): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const params = z.object({ taskId: TaskIdSchema });
  const actor = async (c: Context<AppEnv>) => { const a = await actorFrom(c, (id) => isAdmin(id as UserId)); return { userId: a.userId as UserId, isAdmin: a.isAdmin }; };
  r.get('/v1/tasks/:taskId/agent-terminals', async (c) => c.json(await api.listNativeTerminals(await actor(c), parseParams(c, params).taskId as TaskId)));
  r.post('/v1/tasks/:taskId/agent-terminals', async (c) => c.json(await api.startNativeTerminal(await actor(c), parseParams(c, params).taskId as TaskId, await parseBody(c, StartNativeTerminalRequestSchema)), 202));
  r.post('/v1/tasks/:taskId/agent-terminals/:agentId/stop', async (c) => {
    const p = parseParams(c, params.extend({ agentId: z.string().min(1) }));
    await api.stopNativeTerminal(await actor(c), p.taskId as TaskId, p.agentId);
    return c.body(null, 204);
  });
  return r;
}
