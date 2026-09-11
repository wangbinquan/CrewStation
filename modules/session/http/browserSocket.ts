import type { ServerWebSocket } from 'bun';
import type { TaskId, UserId } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { requireUser } from '@crewstation/http';
import { Hono } from 'hono';
import type { UpgradeWebSocket } from 'hono/ws';
import type { BrowserStream, browserStreams } from '../application/browserStreams';

/** 工作台到任务的流：升级请求带网关身份头；`sinceSeq` 续接。 */
export function browserSocketRoutes(streams: ReturnType<typeof browserStreams>, isAdmin: (userId: UserId) => Promise<boolean>, upgradeWebSocket: UpgradeWebSocket<ServerWebSocket>): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.get('/v1/tasks/:taskId/stream', upgradeWebSocket((c) => {
    const user = requireUser(c);
    const taskId = c.req.param('taskId') as TaskId;
    const sinceSeq = Number(c.req.query('sinceSeq') ?? 0);
    let stream: BrowserStream | undefined;
    const queued: unknown[] = [];
    return {
      onOpen: async (_evt, ws) => {
        try {
          const actor = { userId: user.userId as UserId, isAdmin: await isAdmin(user.userId as UserId) };
          stream = await streams.open(actor, taskId, { send: (frame) => ws.send(frame) }, Number.isFinite(sinceSeq) ? sinceSeq : 0);
          for (const raw of queued.splice(0)) await stream.onMessage(raw);
        } catch (error) {
          ws.send(JSON.stringify({ type: 'error', id: 'open', code: 'forbidden', message: error instanceof Error ? error.message : String(error) }));
          ws.close(1008, 'forbidden');
        }
      },
      onMessage: async (evt) => {
        let raw: unknown;
        try { raw = JSON.parse(String(evt.data)); } catch { return; }
        if (stream) await stream.onMessage(raw); else queued.push(raw);
      },
      onClose: () => { stream?.close(); },
    };
  }));
  return r;
}
