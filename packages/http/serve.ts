import type { Hono } from 'hono';
import type { AppEnv } from './identity';

export interface ServeOptions {
  port: number;
  hostname?: string;
  /** Separate listeners may opt into bounded large streams without raising ordinary API limits. */
  maxRequestBodySize?: number;
  idleTimeout?: number;
  /** hono/bun 的 createBunWebSocket().websocket；有 WebSocket 路由的进程传入。 */
  websocket?: Parameters<typeof Bun.serve>[0] extends { websocket?: infer W } ? W : never;
}

export function serve(app: Hono<AppEnv>, options: ServeOptions): ReturnType<typeof Bun.serve> {
  const base = { port: options.port, hostname: options.hostname ?? '0.0.0.0', fetch: app.fetch,
    ...(options.maxRequestBodySize === undefined ? {} : { maxRequestBodySize: options.maxRequestBodySize }),
    ...(options.idleTimeout === undefined ? {} : { idleTimeout: options.idleTimeout }) };
  return Bun.serve(options.websocket ? ({ ...base, websocket: options.websocket } as Parameters<typeof Bun.serve>[0]) : base);
}
