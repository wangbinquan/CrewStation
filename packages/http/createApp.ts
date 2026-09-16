import { Hono } from 'hono';
import { mapErrorToResponse } from './errorHandler';
import type { AppEnv } from './identity';
import { identityFromHeaders } from './identity';

export interface AppOptions {
  name: string;
  /**
   * 就绪探针：通常是走同一连接池的 `select 1`。拒绝或超过 `readinessTimeoutMs` 时 `/healthz` 返回 503，
   * 让 Kubernetes 把进程摘出路由并按 liveness 重启。2026-09-16 实机：cs-api 进程空闲、健康检查 200，
   * 但所有带身份的请求都卡在数据库客户端上 10s 后被网关 502，没有任何探针能发现。
   */
  readiness?: () => Promise<unknown>;
  readinessTimeoutMs?: number;
}

async function bounded(promise: Promise<unknown>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`readiness probe exceeded ${timeoutMs}ms`)), timeoutMs); })]);
  } finally { if (timer) clearTimeout(timer); }
}

/** 每个 cs-* 进程的 Hono 骨架：健康检查与统一错误映射；路由由各模块的 http/ 挂载。 */
export function createApp(options: AppOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', identityFromHeaders());
  app.get('/healthz', async (c) => {
    if (!options.readiness) return c.json({ ok: true, service: options.name });
    try {
      await bounded(options.readiness(), options.readinessTimeoutMs ?? 3000);
      return c.json({ ok: true, service: options.name });
    } catch (error) {
      return c.json({ ok: false, service: options.name, reason: error instanceof Error ? error.message : String(error) }, 503);
    }
  });
  app.onError((error, c) => mapErrorToResponse(error, c));
  return app;
}
