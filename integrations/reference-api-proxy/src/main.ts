/**
 * 参考 APIProxy 接入容器：对接本机测试 GitLab 的**纯转发**代理（Design §8.1）。
 * 其他接入容器从这里复制：改 `crewstation.yaml` 的 proxy 名、upstream 连接名与 `openapi.yaml`，转发逻辑照搬。
 *
 * 它**不做**的事：不解析身份、不查权限、不持长期凭据、不改写请求体。
 * 放行在请求到达之前就由网关按放行表判完了（Design §8.3），资源级范围由上游或业务把关（Design §8.1、§13.4）。
 */
import { Hono } from 'hono';
import { forward } from './proxy/forward';
import type { FetchLike } from './proxy/forward';
import { PROXY_NAME } from './proxy/catalog';
import { TRACE_HEADER } from './proxy/upstreamRequest';
import { proxyError } from './proxy/upstreamResponse';
import { CONFIG_ENV, readDeploymentInfo } from './platform/environment';
import { platformEgressFetch } from './platform/egressTransport';

export type LogFn = (msg: string, fields: Record<string, unknown>) => void;

export interface AppOptions {
  /** 默认 process.env；测试时注入。 */
  env?: Record<string, string | undefined>;
  /** 调上游用的 fetch；测试时注入假实现。 */
  upstreamFetch?: FetchLike;
  timeoutMs?: number;
  /** 结构化日志：默认每行一条 JSON 写到 stdout；测试时注入静默实现。 */
  log?: LogFn;
}

export function createApp(options: AppOptions = {}): Hono {
  const deployment = readDeploymentInfo(options.env ?? process.env);
  const upstreamFetch = deployment.platformApiUrl ? platformEgressFetch(deployment.platformApiUrl, options.upstreamFetch) : options.upstreamFetch;
  const log = options.log ?? logJsonLine;
  const app = new Hono();

  app.get('/healthz', (c) => c.json({ status: 'ok' }));

  // 自述状态：代理名、部署槽与上游是否已配；不回显上游地址之外的任何配置，更不回显令牌。
  app.get('/', (c) => c.json({
    proxy: PROXY_NAME,
    project: deployment.project,
    service: deployment.service,
    slot: deployment.slot,
    environment: deployment.environment,
    upstreamConfigured: deployment.upstreamBaseUrl !== null,
    upstreamTokenConfigured: deployment.upstreamToken !== null,
  }));

  // 其余一切：原样转给上游。路径就是上游路径——网关已剥掉 `/api/<proxy>/` 前缀。
  app.all('/*', async (c) => {
    const traceId = c.req.raw.headers.get(TRACE_HEADER);
    if (!deployment.upstreamBaseUrl) {
      log('upstream not configured', { env: CONFIG_ENV.upstreamBaseUrl });
      return proxyError('unavailable', `未配置 ${CONFIG_ENV.upstreamBaseUrl}，代理无法转发`, 503, traceId);
    }
    const outcome = await forward(c.req.raw, {
      upstreamBaseUrl: deployment.upstreamBaseUrl,
      upstreamToken: deployment.upstreamToken,
      ...(upstreamFetch ? { fetch: upstreamFetch } : {}),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    });
    log('forwarded', { method: c.req.method, upstreamPath: outcome.upstreamPath, status: outcome.status, traceId });
    return outcome.response;
  });

  return app;
}

/** 一行一条 JSON 日志。只记方法、上游路径与状态码：查询串可能带业务参数，请求头里有凭据，都不进日志。 */
function logJsonLine(msg: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ time: new Date().toISOString(), msg, ...fields }));
}

/**
 * 必须大于 forward.ts 的上游超时：Bun.serve 默认 10 秒就掐掉空闲连接，
 * 那样上游一慢，调用方拿到的是连接被重置，而不是本代理那条带说明的 504。
 */
export const SERVER_IDLE_TIMEOUT_SECONDS = 45;

if (import.meta.main) {
  const deployment = readDeploymentInfo(process.env);
  const server = Bun.serve({ port: deployment.port, idleTimeout: SERVER_IDLE_TIMEOUT_SECONDS, fetch: createApp().fetch });
  logJsonLine('listening', {
    port: server.port, proxy: PROXY_NAME, slot: deployment.slot,
    upstreamConfigured: deployment.upstreamBaseUrl !== null, upstreamTokenConfigured: deployment.upstreamToken !== null,
  });
  const shutdown = (): void => {
    logJsonLine('shutting down', {});
    void server.stop().then(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
