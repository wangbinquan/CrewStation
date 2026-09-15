import { z } from 'zod';

export const EGRESS_HTTP_REQUEST_BYTES = 1024 * 1024;
export const EGRESS_HTTP_RESPONSE_BYTES = 4 * 1024 * 1024;
export const EGRESS_HTTP_TIMEOUT_MS = 8000;
const encodedLimit = Math.ceil(EGRESS_HTTP_REQUEST_BYTES / 3) * 4;
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const target = (raw: string) => { try { const url = new URL(raw); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.hash; } catch { return false; } };

/** APIProxy 经服务域身份使用的 HTTP 出站协议；项目归属由平台解析。 */
export const ForwardEgressHttpRequestSchema = z.object({
  url: z.string().max(8192).refine((v) => bytes(v) <= 8192 && target(v), '目标必须为不含认证信息或片段的 HTTP(S) URL，最多 8 KiB'),
  method: z.enum(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']),
  headers: z.record(z.string().regex(/^[!#$%&'*+.^_`|~0-9a-zA-Z-]+$/), z.string().max(8192).refine((v) => !/[\r\n\0]/.test(v))).refine((v) => bytes(JSON.stringify(v)) <= 32768, '请求头最多 32 KiB'),
  bodyBase64: z.string().max(encodedLimit).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
    .refine((v) => v.length * 3 / 4 - (v.endsWith('==') ? 2 : v.endsWith('=') ? 1 : 0) <= EGRESS_HTTP_REQUEST_BYTES, '请求体最多 1 MiB').optional(),
  timeoutMs: z.number().int().min(100).max(EGRESS_HTTP_TIMEOUT_MS).default(EGRESS_HTTP_TIMEOUT_MS),
}).strict().refine((v) => !['GET', 'HEAD'].includes(v.method) || v.bodyBase64 === undefined, 'GET／HEAD 不允许请求体');

export type ForwardEgressHttpRequest = z.infer<typeof ForwardEgressHttpRequestSchema>;
