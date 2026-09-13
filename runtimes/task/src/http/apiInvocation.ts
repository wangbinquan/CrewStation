import type { ApiInvocationResult, RunnerApiInvocation } from '@crewstation/contracts';
import { API_INVOCATION_BODY_BYTES, API_INVOCATION_HEADER_BYTES, API_INVOCATION_TIMEOUT_MS, API_INVOCATION_URL_BYTES, RunnerApiInvocationSchema } from '@crewstation/contracts';
import { RunnerCommandError } from '../commandError';

/** 只从容器配置取网关根地址，绝不从用户参数接受目的主机。 */
export function createApiInvoker(internalApiBase?: string) {
  const base = gatewayBase(internalApiBase);
  return {
    enabled: base !== undefined,
    async invoke(input: RunnerApiInvocation): Promise<ApiInvocationResult> {
      if (!base) throw new RunnerCommandError('api_invocations_unavailable', '当前开发容器未配置 API 试调通道');
      const parsed = RunnerApiInvocationSchema.safeParse(input);
      if (!parsed.success) throw new RunnerCommandError('api_invocation_invalid', 'API 试调参数不合法或超过大小限制');
      const url = requestUrl(base, parsed.data);
      const headers = requestHeaders(parsed.data.headers);
      const controller = new AbortController();
      const startedAt = performance.now();
      const timer = setTimeout(() => controller.abort(), API_INVOCATION_TIMEOUT_MS);
      try {
        // Bun 的复用连接在中途断线时可能重发 POST；一次试调只允许一次上游调用。
        const response = await fetch(url, { method: input.method, headers, body: input.body, signal: controller.signal, redirect: 'manual', credentials: 'omit', keepalive: false, verbose: false });
        const displayedHeaders = responseHeaders(response.headers);
        const content = await responseText(response);
        return { status: response.status, headers: displayedHeaders.headers, body: content.body, bodyTruncated: content.truncated, headersTruncated: displayedHeaders.truncated, truncated: content.truncated || displayedHeaders.truncated, durationMs: Math.max(0, Math.round(performance.now() - startedAt)) };
      } catch {
        if (controller.signal.aborted) throw new RunnerCommandError('api_invocation_timeout', 'API 试调超过 15 秒；请求可能已执行，请核对业务结果后再决定是否重试');
        throw new RunnerCommandError('api_invocation_failed', 'API 试调未取得完整响应；请求可能已执行，请核对业务结果后再决定是否重试');
      } finally { clearTimeout(timer); }
    },
  };
}

function gatewayBase(raw?: string): URL | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/api/')) return undefined;
    return url;
  } catch { return undefined; }
}

function requestUrl(base: URL, input: RunnerApiInvocation): URL {
  const path = `${base.pathname}${input.proxy}${input.path}`;
  const url = new URL(path, base);
  if (url.origin !== base.origin || url.pathname !== path) throw new RunnerCommandError('api_invocation_invalid', 'API 操作路径发生变化，本次未发送请求');
  for (const [key, values] of Object.entries(input.query)) for (const value of Array.isArray(values) ? values : [values]) url.searchParams.append(key, value);
  if (new TextEncoder().encode(url.href).byteLength > API_INVOCATION_URL_BYTES) throw new RunnerCommandError('api_invocation_invalid', 'API 路径与查询参数总量不能超过 8 KiB');
  return url;
}

function requestHeaders(input: Record<string, string>): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(input)) {
    const key = name.toLowerCase();
    if (headers.has(key) || ['host', 'connection', 'content-length', 'transfer-encoding', 'upgrade', 'trailer', 'te', 'expect', 'cookie', 'forwarded'].includes(key) || key.startsWith('x-cs-') || key.startsWith('x-forwarded-')) throw new RunnerCommandError('api_invocation_invalid', '请求头包含重复名称或平台管理的身份／传输字段，本次未发送请求');
    headers.set(name, value);
  }
  return headers;
}

function responseHeaders(input: Headers): { headers: Record<string, string>; truncated: boolean } {
  const entries: Array<[string, string]> = [];
  let bytes = 0; let truncated = false;
  for (const [name, value] of input) {
    bytes += new TextEncoder().encode(name + value).byteLength + 4;
    if (bytes > API_INVOCATION_HEADER_BYTES) { truncated = true; break; }
    entries.push([name, value]);
  }
  return { headers: Object.fromEntries(entries), truncated };
}

async function responseText(response: Response): Promise<{ body: string; truncated: boolean }> {
  if (!response.body) return { body: '', truncated: false };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let body = ''; let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return { body: body + decoder.decode(), truncated: false };
      const remaining = API_INVOCATION_BODY_BYTES - bytes;
      body += decoder.decode(chunk.value.subarray(0, remaining), { stream: true });
      bytes += chunk.value.byteLength;
      if (bytes > API_INVOCATION_BODY_BYTES) { await reader.cancel(); return { body, truncated: true }; }
    }
  } finally { reader.releaseLock(); }
}
