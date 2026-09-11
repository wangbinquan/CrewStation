import type { ErrorEnvelope } from '@crewstation/contracts';

/** 平台错误体的 `error` 枚举；与 packages/http 的状态码映射一致。 */
export type ApiErrorKind = ErrorEnvelope['error'];

const KIND_BY_STATUS: Readonly<Record<number, ApiErrorKind>> = {
  400: 'validation',
  401: 'unauthenticated',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  412: 'precondition',
  429: 'quota_exceeded',
  503: 'unavailable',
};

const KNOWN_KINDS: ReadonlySet<string> = new Set<ApiErrorKind>([
  'not_found', 'conflict', 'forbidden', 'unauthenticated', 'validation', 'precondition', 'quota_exceeded', 'unavailable', 'internal',
]);

/** 非 2xx 响应或网络失败统一抛出它：`kind` 来自错误体（缺失时按状态码推断），`status` 为 HTTP 状态（网络失败为 0）。 */
export class ApiClientError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(status: number, envelope: ErrorEnvelope, options?: { cause?: unknown }) {
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
export function kindForStatus(status: number): ApiErrorKind {
  return KIND_BY_STATUS[status] ?? (status >= 500 ? 'internal' : 'validation');
}

/** 响应体符合 `{ error, message, details }` 时原样采用（未知 error 值按状态码替换），否则按状态码构造。 */
export function parseErrorEnvelope(status: number, body: unknown): ErrorEnvelope {
  if (isRecord(body) && typeof body.error === 'string' && typeof body.message === 'string') {
    const error = KNOWN_KINDS.has(body.error) ? (body.error as ApiErrorKind) : kindForStatus(status);
    return { error, message: body.message, details: isRecord(body.details) ? body.details : {} };
  }
  return { error: kindForStatus(status), message: `HTTP ${status}`, details: body === undefined ? {} : { body } };
}

export function errorFromResponse(status: number, body: unknown): ApiClientError {
  return new ApiClientError(status, parseErrorEnvelope(status, body));
}

/** fetch 本身失败（断网、DNS、CORS）：status 0，kind unavailable，原因挂在 cause。 */
export function networkError(cause: unknown): ApiClientError {
  const message = cause instanceof Error && cause.message ? cause.message : '网络请求失败';
  return new ApiClientError(0, { error: 'unavailable', message, details: {} }, { cause });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
