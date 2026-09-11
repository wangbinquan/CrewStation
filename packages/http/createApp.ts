import { Hono } from 'hono';
import { mapErrorToResponse } from './errorHandler';

export interface AppOptions {
  name: string;
}

/** 每个 cs-* 进程的 Hono 骨架：健康检查与统一错误映射；路由由各模块的 http/ 挂载。 */
export function createApp(options: AppOptions): Hono {
  const app = new Hono();
  app.get('/healthz', (c) => c.json({ ok: true, service: options.name }));
  app.onError((error, c) => mapErrorToResponse(error, c));
  return app;
}
