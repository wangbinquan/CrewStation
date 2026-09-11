/**
 * 向 cs-events 投递已归一化的事件（Design §8.5）。
 * 请求经服务域发出，**不带任何凭据**：网关按源 Pod IP 认出本服务，cs-events 再核对它是不是该事件类型的登记生产方。
 * 请求体形状对应 packages/contracts/events/delivery.ts 的 ProducedEventSchema，回执对应 ProduceResultDtoSchema。
 */
import { IDENTITY_HEADERS } from '../platform/identity';
import { PRODUCE_PATH } from '../platform/environment';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** ProducedEventSchema：`traceId` 可缺省，缺省时由 cs-events 生成。 */
export interface ProducedEvent {
  eventType: string;
  dedupKey: string;
  occurredAt: string;
  traceId?: string | null;
  payload: unknown;
}

/** ProduceResultDtoSchema：去重命中时 `deduplicated` 为真且 `deliveries` 为 0。 */
export interface ProduceResult {
  eventId: string;
  deduplicated: boolean;
  deliveries: number;
}

/**
 * 投递超时。刻意小于 Bun.serve 默认的 10 秒空闲超时：
 * cs-events 一卡住就在这里收口成一条可重试的失败，GitLab 收到的是 5xx，而不是连接被重置。
 */
export const PRODUCE_TIMEOUT_MS = 8_000;

export interface ProduceOptions {
  /** cs-events 的服务域地址，不含末尾斜杠。 */
  baseUrl: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

/**
 * cs-events 没能受理这条事件。
 * `retryable` 为真表示应当以 5xx 回应 GitLab、由它按自己的策略重投（Design §8.5）。
 */
export class ProduceFailed extends Error {
  constructor(readonly reason: string, readonly retryable: boolean, readonly status?: number) {
    super(reason);
    this.name = 'ProduceFailed';
  }
}

export async function produceEvent(event: ProducedEvent, options: ProduceOptions): Promise<ProduceResult> {
  const response = await send(event, options);
  if (!response.ok) throw await failureOf(response);
  const body: unknown = await response.json().catch(() => null);
  if (!isRecord(body) || typeof body.eventId !== 'string') {
    throw new ProduceFailed('cs-events 的回执不是预期的 ProduceResult', true, response.status);
  }
  return {
    eventId: body.eventId,
    deduplicated: body.deduplicated === true,
    deliveries: typeof body.deliveries === 'number' ? body.deliveries : 0,
  };
}

async function send(event: ProducedEvent, options: ProduceOptions): Promise<Response> {
  const headers = new Headers({ 'content-type': 'application/json', accept: 'application/json' });
  if (event.traceId) headers.set(IDENTITY_HEADERS.traceId, event.traceId);
  const body = JSON.stringify({
    eventType: event.eventType,
    dedupKey: event.dedupKey,
    occurredAt: event.occurredAt,
    ...(event.traceId ? { traceId: event.traceId } : {}),
    payload: event.payload,
  });
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const abort = AbortSignal.timeout(options.timeoutMs ?? PRODUCE_TIMEOUT_MS);
  try {
    return await doFetch(`${options.baseUrl}${PRODUCE_PATH}`, { method: 'POST', headers, body, signal: abort });
  } catch (err) {
    // 连不上或超时：按 Design §8.5 以可重试失败上报，由 GitLab 重投。
    if (abort.aborted) throw new ProduceFailed('cs-events 在超时时间内没有响应', true);
    throw new ProduceFailed(`连接 cs-events 失败：${err instanceof Error ? err.message : String(err)}`, true);
  }
}

/**
 * 5xx 是暂时不可用，值得重投；4xx 多半是登记问题（事件类型还没随发布登记、调用方不是生产方），
 * 重投同样不会成功，但也不能当成受理——那会悄悄丢事件。两种都上报失败，只在可重试性上分开。
 */
async function failureOf(response: Response): Promise<ProduceFailed> {
  const detail = await describeBody(response);
  return new ProduceFailed(`cs-events 拒绝投递：HTTP ${response.status}${detail}`, response.status >= 500, response.status);
}

/** 平台错误信封为 `{ error, message, details }`。 */
async function describeBody(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  if (!text) return '';
  try {
    const envelope: unknown = JSON.parse(text);
    if (isRecord(envelope) && typeof envelope.message === 'string') {
      const code = typeof envelope.error === 'string' ? `${envelope.error}：` : '';
      return `（${code}${envelope.message}）`;
    }
  } catch {
    // 非 JSON 错误体，下面原样截取。
  }
  return `（${text.slice(0, 200)}）`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
