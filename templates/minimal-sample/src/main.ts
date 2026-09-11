/**
 * CrewStation 最小样例：一个用 Bun ＋ Hono 写的数字人服务。
 * 证明五条平台约定：网关身份请求头、配置注入、以服务身份调用平台 API 运行 Agent 子任务、事件订阅处理、向目录开放 API。
 * 没有登录代码、cookie 或令牌：身份只来自网关注入的请求头。
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { EventStore, parseEventDelivery } from './events/gitlabHandler';
import { renderHomePage } from './pages/home';
import { PlatformApiError, runChat } from './platform/agentClient';
import type { FetchLike } from './platform/agentClient';
import { PLATFORM_ENV, readDeploymentInfo } from './platform/environment';
import type { DeploymentInfo } from './platform/environment';
import { readGatewayUser, readSourceService, readTraceId } from './platform/identity';

export type LogFn = (msg: string, fields: Record<string, unknown>) => void;

export interface AppOptions {
  /** 默认 process.env；测试时注入。 */
  env?: Record<string, string | undefined>;
  /** 调平台 API 用的 fetch；测试时注入假实现。 */
  platformFetch?: FetchLike;
  /** 轮询间隔的等待实现；测试时注入以免真等。 */
  sleep?: (ms: number) => Promise<void>;
  eventStore?: EventStore;
  /** 结构化日志：默认每行一条 JSON 写到 stdout；测试时注入静默实现。 */
  log?: LogFn;
}

export function createApp(options: AppOptions = {}): Hono {
  const deployment = readDeploymentInfo(options.env ?? process.env);
  const events = options.eventStore ?? new EventStore();
  const log = options.log ?? logJsonLine;
  const app = new Hono();

  app.get('/healthz', (c) => c.json({ status: 'ok' }));

  app.get('/', (c) => c.html(renderHomePage({
    user: readGatewayUser(c.req.raw.headers),
    deployment,
    events: events.list(),
  })));

  app.post('/chat', (c) => handleChat(c, deployment, options, log));

  app.post('/events/gitlab', (c) => handleGitlabEvent(c, events, log));

  // 向目录开放的唯一 API（openapi.yaml）：调用方身份由网关按源 Pod IP 注入。
  app.get('/api/hello', (c) => {
    const caller = readSourceService(c.req.raw.headers);
    const greeting = deployment.greeting ?? '你好';
    return c.json({ message: `${greeting}，${caller ?? '未识别的调用方'}！`, caller });
  });

  return app;
}

const SUBTASK_STATE_LABEL = { failed: '失败', cancelled: '被取消' } as const;

async function handleChat(c: Context, deployment: DeploymentInfo, options: AppOptions, log: LogFn): Promise<Response> {
  const body: unknown = await c.req.json().catch(() => null);
  const prompt = isRecord(body) && typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) return c.json({ error: '请输入要发给 Agent 的内容。' }, 400);
  if (!deployment.platformApiUrl) {
    return c.json({ error: `未配置 ${PLATFORM_ENV.platformApiUrl}，无法调用平台 API；部署到平台或在开发会话中运行时由平台注入。` }, 503);
  }
  try {
    const result = await runChat(prompt, {
      baseUrl: deployment.platformApiUrl,
      traceId: readTraceId(c.req.raw.headers),
      fetch: options.platformFetch,
      sleep: options.sleep,
    });
    log('chat finished', { taskId: result.taskId, subtaskId: result.subtaskId, state: result.state });
    const ids = { taskId: result.taskId, subtaskId: result.subtaskId };
    if (result.state === 'succeeded') return c.json({ text: result.text, ...ids });
    const detail = result.error ? `：${result.error}` : '';
    return c.json({ error: `Agent 子任务${SUBTASK_STATE_LABEL[result.state]}${detail}`, text: result.text, ...ids }, 502);
  } catch (err) {
    const message = err instanceof PlatformApiError
      ? err.message
      : `调用平台 API 时发生未预期的错误：${err instanceof Error ? err.message : String(err)}`;
    log('chat failed', { error: message });
    return c.json({ error: message }, 502);
  }
}

async function handleGitlabEvent(c: Context, events: EventStore, log: LogFn): Promise<Response> {
  const body: unknown = await c.req.json().catch(() => null);
  const parsed = parseEventDelivery(body);
  if (!parsed.ok) return c.json({ error: parsed.reason }, 400);
  events.add(parsed.event);
  const { eventType, deliveryId, attempt, traceId } = parsed.event;
  log('event accepted', { eventType, deliveryId, attempt, traceId });
  return c.json({ accepted: true, deliveryId }, 202);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** 一行一条 JSON 日志：平台聚合容器 stdout 到工作台日志页。 */
function logJsonLine(msg: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ time: new Date().toISOString(), msg, ...fields }));
}

if (import.meta.main) {
  const deployment = readDeploymentInfo(process.env);
  const server = Bun.serve({ port: deployment.port, fetch: createApp().fetch });
  logJsonLine('listening', { port: server.port, slot: deployment.slot, environment: deployment.environment });
  const shutdown = (): void => {
    logJsonLine('shutting down', {});
    void server.stop().then(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
