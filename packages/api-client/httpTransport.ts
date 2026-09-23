import { errorFromResponse, networkError } from './apiClientError';
import type { Query } from './requestUrl';
import { buildUrl } from './requestUrl';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** fetch 的入参；Bun 的类型里没有全局 `RequestInfo`，这里显式写出三种形态。 */
export type FetchInput = string | URL | Request;

/** fetch 的结构化形状；用它而不是 `typeof fetch`，以免依赖运行时私有属性（Bun 的 `preconnect`）。 */
export type FetchLike = (input: FetchInput, init?: RequestInit) => Promise<Response>;

export interface RequestOptions {
  readonly query?: Query;
  /** 以 JSON 发送的请求体。 */
  readonly body?: unknown;
  readonly signal?: AbortSignal;
  readonly keepalive?: boolean;
  readonly redirect?: RequestRedirect;
}

/** 资源组只依赖它：一次 HTTP 调用，2xx 返回解析后的 JSON（204／空体为 undefined），其余抛 ApiClientError。 */
export interface Transport {
  readonly baseUrl: string;
  request<T>(method: HttpMethod, path: string, options?: RequestOptions): Promise<T>;
}

export interface TransportOptions {
  /** 缺省 ''（同源；用户域由网关注入身份）。给出绝对地址时用于 CLI 与 MCP 进程。 */
  readonly baseUrl?: string;
  /** 缺省 globalThis.fetch；测试与 CLI 可注入。 */
  readonly fetch?: FetchLike;
  /** 附加到每个请求的头（如 CLI 带的令牌头）。 */
  readonly headers?: Readonly<Record<string, string>>;
}

export function createTransport(options: TransportOptions = {}): Transport {
  const baseUrl = options.baseUrl ?? '';
  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  return {
    baseUrl,
    request: async <T>(method: HttpMethod, path: string, request: RequestOptions = {}): Promise<T> => {
      const headers = new Headers({ accept: 'application/json', ...options.headers });
      const init: RequestInit = { method, headers, credentials: 'include' };
      if (request.signal) init.signal = request.signal;
      if (request.keepalive !== undefined) init.keepalive = request.keepalive;
      if (request.redirect !== undefined) init.redirect = request.redirect;
      if (request.body !== undefined) {
        headers.set('content-type', 'application/json');
        init.body = JSON.stringify(request.body);
      }
      let response: Response;
      try {
        response = await fetchImpl(buildUrl(baseUrl, path, request.query), init);
      } catch (cause) {
        throw networkError(cause);
      }
      const payload = await readPayload(response);
      if (!response.ok) throw errorFromResponse(response.status, payload, response.headers);
      return payload as T;
    },
  };
}

async function readPayload(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const text = await response.text();
  if (text.length === 0) return undefined;
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('json')) return text;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
