/**
 * 内置 GitLab 格式的 EventProducer 接入容器（Design §8.5）。
 * 只做四件事：验 webhook 密钥 → 归一化成平台事件类型 → 算稳定的去重键 → 以自身身份投给 cs-events。
 * 没有登录代码、没有凭据、不解析身份令牌：请求经服务域进来，投递也经服务域出去，调用方身份由网关按源 Pod IP 解析。
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { ProduceFailed, produceEvent } from './events/eventsClient';
import type { FetchLike } from './events/eventsClient';
import { deriveDedupKey } from './gitlab/dedupKey';
import { GITLAB_EVENT_HEADER, PRODUCER_NAME, allEventTypes, mapEventType } from './gitlab/eventType';
import { deriveOccurredAt } from './gitlab/occurredAt';
import { GITLAB_TOKEN_HEADER, verifyWebhookToken } from './gitlab/webhookToken';
import { CONFIG_ENV, readDeploymentInfo } from './platform/environment';
import type { DeploymentInfo } from './platform/environment';
import { readTraceId } from './platform/identity';

/** Manifest `spec.ingress.path`：GitLab webhook 指向的路径，两处必须一致。 */
export const INGRESS_PATH = '/hooks/gitlab';

export type LogFn = (msg: string, fields: Record<string, unknown>) => void;

export interface AppOptions {
  /** 默认 process.env；测试时注入。 */
  env?: Record<string, string | undefined>;
  /** 调 cs-events 用的 fetch；测试时注入假实现。 */
  eventsFetch?: FetchLike;
  /** 投递超时，默认 PRODUCE_TIMEOUT_MS。 */
  produceTimeoutMs?: number;
  /** 结构化日志：默认每行一条 JSON 写到 stdout；测试时注入静默实现。 */
  log?: LogFn;
  now?: () => Date;
}

export function createApp(options: AppOptions = {}): Hono {
  const deployment = readDeploymentInfo(options.env ?? process.env);
  const log = options.log ?? logJsonLine;
  const app = new Hono();

  app.get('/healthz', (c) => c.json({ status: 'ok' }));

  // 服务域上的自述状态：不含任何密钥，只说清自己是谁、往哪投、登记了哪些事件类型。
  app.get('/', (c) => c.json({
    producer: PRODUCER_NAME,
    project: deployment.project,
    service: deployment.service,
    slot: deployment.slot,
    environment: deployment.environment,
    ingressPath: INGRESS_PATH,
    eventsBaseUrl: deployment.eventsBaseUrl,
    webhookSecretConfigured: deployment.webhookSecretToken !== null,
    eventTypes: allEventTypes(),
  }));

  app.post(INGRESS_PATH, (c) => handleWebhook(c, deployment, options, log));

  return app;
}

/**
 * 回应 GitLab 的约定：
 * 401 密钥不符；400 请求体不是 JSON 对象；202 已受理或已去重；
 * 202＋ignored 不产生事件的钩子（让 GitLab 别再重投）；5xx cs-events 暂时不可用，由 GitLab 重投（Design §8.5）。
 */
async function handleWebhook(c: Context, deployment: DeploymentInfo, options: AppOptions, log: LogFn): Promise<Response> {
  const headers = c.req.raw.headers;
  const token = verifyWebhookToken(headers.get(GITLAB_TOKEN_HEADER), deployment.webhookSecretToken);
  if (!token.ok) {
    log('webhook rejected', { reason: token.reason, hook: headers.get(GITLAB_EVENT_HEADER) });
    return c.json({ error: 'unauthenticated', message: token.reason }, 401);
  }
  const payload: unknown = await c.req.json().catch(() => null);
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return c.json({ error: 'validation', message: '请求体必须是 GitLab webhook 的 JSON 对象' }, 400);
  }
  const mapped = mapEventType(headers.get(GITLAB_EVENT_HEADER), payload);
  if (!mapped.ok) {
    log('webhook ignored', { reason: mapped.reason });
    return c.json({ accepted: false, ignored: true, reason: mapped.reason }, 202);
  }
  if (!deployment.eventsBaseUrl) {
    log('webhook deferred', { reason: '未注入 CS_SERVICE_DOMAIN，推导不出 cs-events 地址' });
    return c.json({ error: 'unavailable', message: '推导不出 cs-events 地址，稍后重试' }, 503);
  }
  return forward(c, mapped.eventType, payload, deployment.eventsBaseUrl, options, log);
}

async function forward(
  c: Context, eventType: string, payload: unknown, baseUrl: string, options: AppOptions, log: LogFn,
): Promise<Response> {
  const headers = c.req.raw.headers;
  const now = (options.now ?? (() => new Date()))();
  const dedup = deriveDedupKey(eventType, headers, payload);
  const event = { eventType, dedupKey: dedup.key, occurredAt: deriveOccurredAt(payload, now), traceId: readTraceId(headers), payload };
  try {
    const result = await produceEvent(event, {
      baseUrl,
      ...(options.eventsFetch ? { fetch: options.eventsFetch } : {}),
      ...(options.produceTimeoutMs === undefined ? {} : { timeoutMs: options.produceTimeoutMs }),
    });
    log('event produced', { eventType, dedupSource: dedup.source, eventId: result.eventId, deduplicated: result.deduplicated, deliveries: result.deliveries });
    return c.json({ accepted: true, eventType, eventId: result.eventId, deduplicated: result.deduplicated, deliveries: result.deliveries }, 202);
  } catch (err) {
    const failure = err instanceof ProduceFailed ? err : new ProduceFailed(`投递 cs-events 时发生未预期的错误：${String(err)}`, true);
    log('event produce failed', { eventType, reason: failure.reason, retryable: failure.retryable, status: failure.status });
    // 一律 5xx：受理不了就让 GitLab 知道，别把事件悄悄丢掉。
    return c.json({ error: 'unavailable', message: failure.reason }, failure.retryable ? 503 : 502);
  }
}

/** 一行一条 JSON 日志：平台聚合容器 stdout 到工作台日志页。密钥与 webhook 正文都不进日志。 */
function logJsonLine(msg: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ time: new Date().toISOString(), msg, ...fields }));
}

if (import.meta.main) {
  const deployment = readDeploymentInfo(process.env);
  const server = Bun.serve({ port: deployment.port, fetch: createApp().fetch });
  logJsonLine('listening', {
    port: server.port, slot: deployment.slot, producer: PRODUCER_NAME, ingressPath: INGRESS_PATH,
    eventsBaseUrl: deployment.eventsBaseUrl, webhookSecretConfigured: deployment.webhookSecretToken !== null,
  });
  if (deployment.webhookSecretToken === null) {
    logJsonLine('webhook secret missing', { env: CONFIG_ENV.webhookSecretToken, effect: '一切 webhook 请求都会被拒绝' });
  }
  const shutdown = (): void => {
    logJsonLine('shutting down', {});
    void server.stop().then(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
