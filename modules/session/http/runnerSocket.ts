import type { ServerWebSocket } from 'bun';
import type { AppEnv } from '@crewstation/http';
import { Hono } from 'hono';
import type { UpgradeWebSocket } from 'hono/ws';
import type { ActiveRunnerConnection, RunnerHub } from '../application/runnerHub';

/**
 * TaskRunner 出向连接的入口：首帧 hello，之后按协议收发。
 *
 * 帧必须串行处理：hello 要查令牌、读 maxSeq、抢注册表，全是异步；期间到达的帧如果并发进来，
 * 会因为 connection 还没赋值而被当成第二个 hello，以 1008「首帧必须是 hello」断开——
 * TaskRunner 收到 welcome 后立刻补发重放事件，本机集群里稳定触发重连风暴。
 * 串行还顺带保证事件按 seq 顺序落库。
 */
export function runnerSocketRoutes(hub: RunnerHub, upgradeWebSocket: UpgradeWebSocket<ServerWebSocket>): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.get('/runner', upgradeWebSocket(() => {
    let connection: ActiveRunnerConnection | undefined;
    let closed = false;
    let chain: Promise<void> = Promise.resolve();

    const handle = async (data: string, ws: ServerWebSocket): Promise<void> => {
      if (closed) return;
      let raw: unknown;
      try {
        raw = JSON.parse(data);
      } catch {
        ws.send(JSON.stringify({ type: 'error', id: '', code: 'bad_frame', message: '不是 JSON' }));
        return;
      }
      if (connection) {
        await hub.onMessage(connection, raw);
        return;
      }
      const opened = await hub.onHello(raw, { send: (frame) => ws.send(frame) });
      if (!opened.ok) {
        closed = true;
        ws.send(JSON.stringify({ type: 'error', id: 'hello', code: opened.code, message: opened.message }));
        ws.close(1008, opened.message);
        return;
      }
      connection = opened.connection;
    };

    return {
      onMessage: (evt, ws) => {
        const data = String(evt.data);
        const socket = ws as unknown as ServerWebSocket;
        // 每一环单独兜错：链上任何一次拒绝都会让后续 then 整体跳过，帧会被静默丢光。
        // 处理失败就断开，让 TaskRunner 按 seq 重连续传（协议自带的恢复路径）。
        chain = chain.then(() => handle(data, socket)).catch(() => {
          if (closed) return;
          closed = true;
          socket.close(1011, '服务端处理帧失败');
        });
      },
      onClose: async () => {
        closed = true;
        await chain.catch(() => undefined);
        if (connection) await hub.onClose(connection);
      },
    };
  }));
  return r;
}
