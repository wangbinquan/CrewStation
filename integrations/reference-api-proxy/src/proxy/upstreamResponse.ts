/**
 * 把上游响应原样交回调用方：状态码与响应体不改，只在响应头上剥掉不能回传的部分。
 * 纯函数，不读也不缓冲响应体——响应体是流，交给调用方直接消费。
 */
import { TRACE_HEADER } from './upstreamRequest';

/**
 * 不回传给调用方的响应头。
 * - 逐跳头与内容编码：响应体经 fetch 已解压，原样带回 `content-encoding` 会让调用方二次解压失败；
 * - `content-length`：同理，解压后长度已变；
 * - `set-cookie`：代理不在调用方那边种上游的会话；
 * - 上游的分页／限流等 `x-` 头保留，它们是业务要的信息。
 */
const DROPPED_HEADERS = new Set([
  'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'te', 'trailer',
  'content-encoding', 'content-length', 'set-cookie',
]);

/** @param traceId 本次请求的平台 traceId；回显它，调用方日志与上游日志能对上同一条链路。 */
export function downstreamHeaders(upstream: Headers, traceId?: string | null): Headers {
  const out = new Headers();
  for (const [name, value] of upstream) {
    if (DROPPED_HEADERS.has(name.toLowerCase())) continue;
    out.set(name, value);
  }
  if (traceId) out.set(TRACE_HEADER, traceId);
  return out;
}

/** 平台错误信封 `{ error, message }`（packages/contracts/api/envelope.ts）；代理自己出的错才用它，上游的错原样回传。 */
export function proxyError(error: string, message: string, status: number, traceId?: string | null): Response {
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8' });
  if (traceId) headers.set(TRACE_HEADER, traceId);
  return new Response(JSON.stringify({ error, message, details: {} }), { status, headers });
}
