import type { Hono } from 'hono';
import type { AppEnv } from './identity';

export interface ServeOptions {
  port: number;
  hostname?: string;
  /** hono/bun 的 createBunWebSocket().websocket；有 WebSocket 路由的进程传入。 */
  websocket?: Parameters<typeof Bun.serve>[0] extends { websocket?: infer W } ? W : never;
}

export function serve(app: Hono<AppEnv>, options: ServeOptions): ReturnType<typeof Bun.serve> {
  const base = { port: options.port, hostname: options.hostname ?? '0.0.0.0', fetch: app.fetch };
  return Bun.serve(options.websocket ? ({ ...base, websocket: options.websocket } as Parameters<typeof Bun.serve>[0]) : base);
}
