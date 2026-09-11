import type { RunnerEvent, TaskId } from '@crewstation/contracts';
import { RunnerCommandSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { parseBody, parseQuery } from '@crewstation/http';
import { Hono } from 'hono';
import { z } from 'zod';
import type { commandDispatch } from '../application/commandDispatch';
import type { SessionUseCaseDeps } from '../application/dependencies';
import { FORWARDED_HEADER } from '../adapters/http/fetchForwarder';

const eventsQuery = z.object({ sinceSeq: z.coerce.number().int().min(0).default(0), kinds: z.string().optional(), agentId: z.string().optional(), limit: z.coerce.number().int().min(1).max(5000).default(500) });

/** 进程间接口（只在系统命名空间内可达）：业务任务与开发会话模块经它向 TaskRunner 下发命令、读取持久事件。 */
export function internalRoutes(dispatch: ReturnType<typeof commandDispatch>, deps: Pick<SessionUseCaseDeps, 'events'>): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.post('/internal/tasks/:taskId/commands', async (c) => {
    const taskId = c.req.param('taskId') as TaskId;
    const command = await parseBody(c, RunnerCommandSchema);
    const payload = c.req.header(FORWARDED_HEADER) ? await dispatch.sendLocalOnly(taskId, command) : await dispatch.sendCommand(taskId, command);
    return c.json({ payload });
  });
  r.get('/internal/tasks/:taskId/events', async (c) => {
    const q = parseQuery(c, eventsQuery);
    const items = await deps.events.listSince(c.req.param('taskId') as TaskId, q.sinceSeq, { limit: q.limit, ...(q.kinds ? { kinds: q.kinds.split(',') as RunnerEvent['kind'][] } : {}), ...(q.agentId ? { agentId: q.agentId } : {}) });
    return c.json({ items: items.map((e) => ({ seq: e.seq, at: e.at.toISOString(), event: e.event })) });
  });
  r.get('/internal/tasks/:taskId/connection', async (c) => c.json(await dispatch.connectionStatus(c.req.param('taskId') as TaskId)));
  return r;
}
