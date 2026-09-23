import type { ErrorEnvelope } from '@crewstation/contracts';

/**
 * 错误类别：平台错误体的 `error` 枚举（与 packages/http 的状态码映射一致），加上客户端认出的 `rate_limited`——
 * 网关限流（RFC-025 设计 §7.3）返回的 429 不带平台错误体；平台自己的额度不足也是 429，但带 `quota_exceeded` 错误体。
 */
export type ApiErrorKind = ErrorEnvelope['error'] | 'rate_limited';

/** 错误体的形状：平台的 ErrorEnvelope，或客户端为网关限流构造的一份。 */
export interface ApiErrorEnvelope {
  readonly error: ApiErrorKind;
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
}

type PlatformErrorKind = ErrorEnvelope['error'];

const KIND_BY_STATUS: Readonly<Record<number, PlatformErrorKind>> = {
  400: 'validation',
  401: 'unauthenticated',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  412: 'precondition',
  429: 'quota_exceeded',
  503: 'unavailable',
};

const KNOWN_KINDS: ReadonlySet<string> = new Set<PlatformErrorKind>([
  'not_found', 'conflict', 'forbidden', 'unauthenticated', 'validation', 'precondition', 'quota_exceeded', 'unavailable', 'internal',
]);

/** 非 2xx 响应或网络失败统一抛出它：`kind` 来自错误体（缺失时按状态码推断），`status` 为 HTTP 状态（网络失败为 0）。 */
export class ApiClientError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(status: number, envelope: ApiErrorEnvelope, options?: { cause?: unknown }) {
    super(envelope.message, options);
    this.name = 'ApiClientError';
    this.kind = envelope.error;
    this.status = status;
    this.details = envelope.details;
  }
}

export function isApiClientError(value: unknown): value is ApiClientError {
  return value instanceof ApiClientError;
}

/** 状态码到错误类别：已知码查表，其余 5xx 视为 internal，其余 4xx 视为 validation。 */
export function kindForStatus(status: number): PlatformErrorKind {
  return KIND_BY_STATUS[status] ?? (status >= 500 ? 'internal' : 'validation');
}

/** 响应体符合 `{ error, message, details }` 时原样采用（未知 error 值按状态码替换），否则按状态码构造。 */
export function parseErrorEnvelope(status: number, body: unknown): ErrorEnvelope {
  if (isRecord(body) && typeof body.error === 'string' && typeof body.message === 'string') {
    const error = KNOWN_KINDS.has(body.error) ? (body.error as PlatformErrorKind) : kindForStatus(status);
    return { error, message: body.message, details: isRecord(body.details) ? body.details : {} };
  }
  return { error: kindForStatus(status), message: `HTTP ${status}`, details: body === undefined ? {} : { body } };
}

export function errorFromResponse(status: number, body: unknown, headers?: Headers): ApiClientError {
  if (status === 429 && !isPlatformEnvelope(body)) {
    const retryAfter = retryAfterSeconds(headers?.get('retry-after') ?? null);
    return new ApiClientError(429, { error: 'rate_limited', message: retryAfter === undefined ? '请求过于频繁，请稍后再试' : `请求过于频繁，${retryAfter} 秒后再试`, details: retryAfter === undefined ? {} : { retryAfter } });
  }
  return new ApiClientError(status, parseErrorEnvelope(status, body));
}

/** Retry-After 可以是秒数，也可以是 HTTP 日期；认不出就当没有。 */
export function retryAfterSeconds(header: string | null, now: number = Date.now()): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const at = Date.parse(trimmed);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - now) / 1000));
}

function isPlatformEnvelope(body: unknown): boolean {
  return isRecord(body) && typeof body.error === 'string' && typeof body.message === 'string';
}

/** fetch 本身失败（断网、DNS、CORS）：status 0，kind unavailable，原因挂在 cause。 */
export function networkError(cause: unknown): ApiClientError {
  const message = cause instanceof Error && cause.message ? cause.message : '网络请求失败';
  return new ApiClientError(0, { error: 'unavailable', message, details: {} }, { cause });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
