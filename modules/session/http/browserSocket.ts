import type { ServerWebSocket } from 'bun';
import type { TaskId, UserId } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { requireUser } from '@crewstation/http';
import { isPlatformError } from '@crewstation/kernel';
import { Hono } from 'hono';
import type { UpgradeWebSocket } from 'hono/ws';
import type { BrowserStream, browserStreams } from '../application/browserStreams';

/**
 * 工作台到任务的流：升级请求带网关身份头；`sinceSeq` 续接。
 * 帧串行处理：open 期间到达的命令要排在 open 之后，open 之后到达的又要排在补发的队列之后，
 * 单条链是唯一能同时保证这两点的写法。
 */
export function browserSocketRoutes(streams: ReturnType<typeof browserStreams>, isAdmin: (userId: UserId) => Promise<boolean>, upgradeWebSocket: UpgradeWebSocket<ServerWebSocket>): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.get('/v1/tasks/:taskId/stream', upgradeWebSocket((c) => {
    const user = requireUser(c);
    const taskId = c.req.param('taskId') as TaskId;
    const sinceSeq = Number(c.req.query('sinceSeq') ?? 0);
    let stream: BrowserStream | undefined;
    let chain: Promise<void> = Promise.resolve();

    return {
      onOpen: (_evt, ws) => {
        const socket = ws as unknown as ServerWebSocket;
        chain = chain.then(async () => {
          const actor = { userId: user.userId as UserId, isAdmin: await isAdmin(user.userId as UserId) };
          stream = await streams.open(actor, taskId, { send: (frame) => socket.send(frame) }, Number.isSafeInteger(sinceSeq) && sinceSeq >= 0 ? sinceSeq : 0);
        }).catch((error: unknown) => {
          const denied = isPlatformError(error) && error.kind === 'forbidden';
          socket.send(JSON.stringify({ type: 'error', id: 'open', code: denied ? 'forbidden' : 'unavailable', message: denied ? error.message : '会话历史暂时无法读取，正在重新连接' }));
          socket.close(denied ? 1008 : 1013, denied ? 'forbidden' : 'replay unavailable');
        });
      },
      onMessage: (evt) => {
        let raw: unknown;
        try {
          raw = JSON.parse(String(evt.data));
        } catch {
          return;
        }
        chain = chain.then(() => stream?.onMessage(raw)).catch(() => undefined);
      },
      onClose: () => {
        void chain.finally(() => stream?.close());
      },
    };
  }));
  return r;
}
