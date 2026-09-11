import type { ServerWebSocket } from 'bun';
import type { AppEnv } from '@crewstation/http';
import { Hono } from 'hono';
import type { UpgradeWebSocket } from 'hono/ws';
import type { RunnerConnection } from '../domain/runnerConnection';
import type { RunnerHub } from '../application/runnerHub';

/** TaskRunner 出向连接的入口：首帧 hello，之后按协议收发。 */
export function runnerSocketRoutes(hub: RunnerHub, upgradeWebSocket: UpgradeWebSocket<ServerWebSocket>): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.get('/runner', upgradeWebSocket(() => {
    let connection: RunnerConnection | undefined;
    return {
      onMessage: async (evt, ws) => {
        let raw: unknown;
        try { raw = JSON.parse(String(evt.data)); } catch { ws.send(JSON.stringify({ type: 'error', id: '', code: 'bad_frame', message: '不是 JSON' })); return; }
        if (!connection) {
          const opened = await hub.onHello(raw, { send: (frame) => ws.send(frame) });
          if (!opened.ok) { ws.send(JSON.stringify({ type: 'error', id: 'hello', code: opened.code, message: opened.message })); ws.close(1008, opened.message); return; }
          connection = opened.connection;
          return;
        }
        await hub.onMessage(connection, raw);
      },
      onClose: async () => { if (connection) await hub.onClose(connection); },
    };
  }));
  return r;
}
