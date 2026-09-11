/** 平台 API 的错误响应体：{ error, message, details }。 */
export interface ApiErrorEnvelope {
  readonly error: string;
  readonly message: string;
  readonly details?: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, envelope: ApiErrorEnvelope) {
    super(envelope.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = envelope.error;
    this.details = envelope.details;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/** 非 2xx 响应体若符合错误体形状则原样采用，否则按状态码构造一个。 */
export function toErrorEnvelope(status: number, body: unknown): ApiErrorEnvelope {
  if (typeof body === 'object' && body !== null && 'error' in body && 'message' in body) {
    const { error, message, details } = body as { error: unknown; message: unknown; details?: unknown };
    if (typeof error === 'string' && typeof message === 'string') return { error, message, details };
  }
  return { error: `http_${status}`, message: `HTTP ${status}`, details: body };
}
