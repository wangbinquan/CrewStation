import { ApiError, toErrorEnvelope } from './apiError';

export type ApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiRequestOptions {
  readonly method?: ApiMethod;
  /** 以 JSON 发送的请求体。 */
  readonly body?: unknown;
  readonly query?: Readonly<Record<string, string | number | boolean | undefined>>;
  readonly headers?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
}

/**
 * 对平台 API 的类型化 fetch：同源请求（用户域由网关注入身份，前端不带凭据），
 * 2xx 返回解析后的 JSON，其余状态抛出 ApiError（错误体 { error, message, details }）。
 */
export async function apiFetch<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const headers = new Headers({ accept: 'application/json', ...options.headers });
  const init: RequestInit = { method: options.method ?? 'GET', headers, credentials: 'same-origin' };
  if (options.signal) init.signal = options.signal;
  if (options.body !== undefined) {
    headers.set('content-type', 'application/json');
    init.body = JSON.stringify(options.body);
  }
  const response = await fetch(withQuery(path, options.query), init);
  const payload = await readPayload(response);
  if (!response.ok) throw new ApiError(response.status, toErrorEnvelope(response.status, payload));
  return payload as T;
}

export function withQuery(path: string, query?: ApiRequestOptions['query']): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const encoded = params.toString();
  return encoded ? `${path}${path.includes('?') ? '&' : '?'}${encoded}` : path;
}

async function readPayload(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const text = await response.text();
  if (text.length === 0) return undefined;
  const contentType = response.headers.get('content-type') ?? '';
  return contentType.includes('json') ? (JSON.parse(text) as unknown) : text;
}
