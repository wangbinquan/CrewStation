import type { Hono } from 'hono';

export interface ServeOptions {
  port: number;
  hostname?: string;
}

export function serve(app: Hono, options: ServeOptions): ReturnType<typeof Bun.serve> {
  return Bun.serve({ port: options.port, hostname: options.hostname ?? '0.0.0.0', fetch: app.fetch });
}
