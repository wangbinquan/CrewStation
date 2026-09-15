import type { TaskId, UserId } from '@crewstation/contracts';
import { AgentActivityQuerySchema, ReadAgentActivityRequestSchema, StartNativeTerminalRequestSchema, TaskIdSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { actorFrom, parseBody, parseParams, parseQuery } from '@crewstation/http';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { NativeTerminalApi } from '../api/moduleApi';
import type { DevSessionModuleApi } from '../api/moduleApi';

export function nativeTerminalRoutes(api: NativeTerminalApi & Pick<DevSessionModuleApi, 'getAgentActivity' | 'readAgentActivity'>, isAdmin: (id: UserId) => Promise<boolean>): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const params = z.object({ taskId: TaskIdSchema });
  const actor = async (c: Context<AppEnv>) => { const a = await actorFrom(c, (id) => isAdmin(id as UserId)); return { userId: a.userId as UserId, isAdmin: a.isAdmin }; };
  r.use('/v1/tasks/:taskId/agent-activity*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next(); });
  r.get('/v1/tasks/:taskId/agent-activity', async (c) => c.json(await api.getAgentActivity(await actor(c), parseParams(c, params).taskId, parseQuery(c, AgentActivityQuerySchema))));
  r.post('/v1/tasks/:taskId/agent-activity/read', async (c) => c.json(await api.readAgentActivity(await actor(c), parseParams(c, params).taskId, await parseBody(c, ReadAgentActivityRequestSchema))));
  r.get('/v1/tasks/:taskId/agent-terminals', async (c) => c.json(await api.listNativeTerminals(await actor(c), parseParams(c, params).taskId as TaskId)));
  r.get('/v1/tasks/:taskId/agent-terminals/:agentId/snapshot', async (c) => {
    c.header('Cache-Control', 'no-store');
    const p = parseParams(c, params.extend({ agentId: z.string().min(1) }));
    return c.json(await api.getNativeTerminalSnapshot(await actor(c), p.taskId, p.agentId));
  });
  r.post('/v1/tasks/:taskId/agent-terminals', async (c) => c.json(await api.startNativeTerminal(await actor(c), parseParams(c, params).taskId as TaskId, await parseBody(c, StartNativeTerminalRequestSchema)), 202));
  r.post('/v1/tasks/:taskId/agent-terminals/:agentId/stop', async (c) => {
    const p = parseParams(c, params.extend({ agentId: z.string().min(1) }));
    await api.stopNativeTerminal(await actor(c), p.taskId as TaskId, p.agentId);
    return c.body(null, 204);
  });
  return r;
}
