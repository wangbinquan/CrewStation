import { PlatformError } from '@crewstation/kernel';
import { mapGitLabError, redactSecret } from './errors';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
export type QueryValue = string | number | boolean | undefined;

export interface TransportOptions {
  /** 任意可达地址，例如 `http://127.0.0.1:8929` 或集群内的 `http://host.docker.internal:8929`。 */
  readonly baseUrl: string;
  readonly token: string;
  readonly fetch?: typeof fetch;
}

export interface RequestOptions {
  readonly query?: Record<string, QueryValue>;
  readonly body?: unknown;
}

export interface Transport {
  request<T>(method: HttpMethod, path: string, options?: RequestOptions): Promise<T>;
  /** 按 `x-next-page` 翻页直到取完；每页 100 条。 */
  requestAll<T>(path: string, query?: Record<string, QueryValue>): Promise<T[]>;
}

const PAGE_SIZE = 100;

/** 令牌只进 `PRIVATE-TOKEN` 头，绝不进 URL；错误消息经 redactSecret 过滤后才抛出。 */
export function createTransport(options: TransportOptions): Transport {
  const apiRoot = `${options.baseUrl.replace(/\/+$/, '')}/api/v4`;
  const doFetch = options.fetch ?? fetch;
  const redact = (text: string): string => redactSecret(text, options.token);

  const raw = async (method: HttpMethod, path: string, request: RequestOptions): Promise<{ data: unknown; headers: Headers }> => {
    const url = new URL(`${apiRoot}${path}`);
    for (const [key, value] of Object.entries(request.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const headers: Record<string, string> = { 'PRIVATE-TOKEN': options.token, accept: 'application/json' };
    if (request.body !== undefined) headers['content-type'] = 'application/json';
    let response: Response;
    try {
      response = await doFetch(url, { method, headers, ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }) });
    } catch (error) {
      throw new PlatformError('unavailable', `GitLab 不可达：${redact(error instanceof Error ? error.message : String(error))}`, { method, path });
    }
    const text = await response.text();
    if (!response.ok) throw mapGitLabError(response.status, redact(text), { method, path });
    return { data: parseBody(text, response.headers.get('content-type')), headers: response.headers };
  };

  return {
    request: async <T>(method: HttpMethod, path: string, request: RequestOptions = {}): Promise<T> => (await raw(method, path, request)).data as T,
    requestAll: async <T>(path: string, query: Record<string, QueryValue> = {}): Promise<T[]> => {
      const items: T[] = [];
      const pages = new Set<string>();
      let page: string | undefined = '1';
      while (page) {
        if (!/^[1-9][0-9]*$/.test(page) || !Number.isSafeInteger(Number(page)) || pages.has(page)) throw new PlatformError('unavailable', 'GitLab 分页来源不完整', { method: 'GET', path });
        pages.add(page);
        const { data, headers } = await raw('GET', path, { query: { ...query, per_page: PAGE_SIZE, page } });
        if (!Array.isArray(data)) throw new PlatformError('unavailable', 'GitLab 分页内容不是数组', { method: 'GET', path });
        items.push(...(data as T[]));
        const cursor = headers.get('x-next-page'), next = cursor || undefined;
        if (cursor === null && data.length >= PAGE_SIZE) throw new PlatformError('unavailable', 'GitLab 完整分页缺少下一页标记', { method: 'GET', path });
        if (next && (!/^[1-9][0-9]*$/.test(next) || !Number.isSafeInteger(Number(next)) || Number(next) !== Number(page) + 1)) throw new PlatformError('unavailable', 'GitLab 分页来源未连续向前推进', { method: 'GET', path });
        page = next;
      }
      return items;
    },
  };
}

function parseBody(text: string, contentType: string | null): unknown {
  if (!text) return undefined;
  if (contentType?.includes('json')) return JSON.parse(text) as unknown;
  return text;
}

/** 项目引用：数字 ID 直接用，路径整体 URL 编码（`group/proj` → `group%2Fproj`）。 */
export function encodeRef(ref: number | string): string {
  return encodeURIComponent(String(ref));
}
