/**
 * 转发本身：按 planUpstreamRequest 的计划发出请求，把上游响应原样交回。
 * **不做鉴权**——一次调用能到这里，说明网关已按放行表判过（Design §8.3）；资源级范围由上游把关（Design §8.1）。
 */
import { downstreamHeaders, proxyError } from './upstreamResponse';
import { TRACE_HEADER, hasRequestBody, planUpstreamRequest } from './upstreamRequest';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ForwardOptions {
  /** 上游地址，不含末尾斜杠。 */
  readonly upstreamBaseUrl: string;
  readonly upstreamToken?: string | null;
  readonly fetch?: FetchLike;
  /** 上游超时，默认 30 秒；超时按 504 回应，不无限占着调用方的连接。 */
  readonly timeoutMs?: number;
}

export const DEFAULT_TIMEOUT_MS = 30_000;

export interface ForwardOutcome {
  readonly response: Response;
  /** 供日志使用；不含查询串与任何请求头。 */
  readonly upstreamPath: string;
  readonly status: number;
}

export async function forward(request: Request, options: ForwardOptions): Promise<ForwardOutcome> {
  const traceId = request.headers.get(TRACE_HEADER);
  const plan = planUpstreamRequest({
    requestUrl: request.url, method: request.method, headers: request.headers,
    upstreamBaseUrl: options.upstreamBaseUrl, upstreamToken: options.upstreamToken ?? null,
  });
  const upstreamPath = new URL(plan.url).pathname;
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const abort = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const upstream = await doFetch(plan.url, {
      method: plan.method,
      headers: plan.headers,
      ...(hasRequestBody(plan.method) ? { body: request.body, duplex: 'half' } as RequestInit : {}),
      redirect: 'manual',
      signal: abort,
    });
    const response = new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: downstreamHeaders(upstream.headers, traceId) });
    return { response, upstreamPath, status: upstream.status };
  } catch (err) {
    return { response: failureResponse(err, abort, traceId), upstreamPath, status: 0 };
  }
}

/** 上游连不上或超时：回 502／504，说明里只写原因，绝不带凭据或上游地址细节。 */
function failureResponse(err: unknown, abort: AbortSignal, traceId: string | null): Response {
  if (abort.aborted) return proxyError('unavailable', '上游在超时时间内没有响应', 504, traceId);
  const detail = err instanceof Error ? err.message : String(err);
  return proxyError('unavailable', `连接上游失败：${detail}`, 502, traceId);
}
