import { z } from 'zod';
import { SlugSchema } from '../ids';
import { HttpMethodSchema } from '../manifest/serviceSpec';

export const API_INVOCATION_TIMEOUT_MS = 15_000;
export const API_INVOCATION_BODY_BYTES = 65_536;
export const API_INVOCATION_HEADER_BYTES = 16_384;
export const API_INVOCATION_URL_BYTES = 8192;
export const API_INVOCATION_MAX_FIELDS = 64;

const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;
const fieldName = z.string().min(1).max(128);
const value = z.string().max(API_INVOCATION_URL_BYTES);
const fieldCount = (fields: object) => Object.keys(fields).length <= API_INVOCATION_MAX_FIELDS;
export const ApiPathParametersSchema = z.record(fieldName, value).refine(fieldCount, '最多 64 个路径参数');
export const ApiQueryParametersSchema = z.record(fieldName, z.union([value, z.array(value).max(16)])).refine(fieldCount, '最多 64 个查询参数，每项最多 16 个值');
export const ApiInvocationHeadersSchema = z.record(z.string().regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/, '请求头名称不合法'), value)
  .refine(fieldCount, '最多 64 个请求头')
  .refine((headers) => Object.entries(headers).reduce((bytes, [key, text]) => bytes + byteLength(key + text) + 4, 0) <= API_INVOCATION_HEADER_BYTES, '请求头总量不能超过 16 KiB')
  .refine((headers) => Object.values(headers).every((text) => /^[\t\x20-\x7e\x80-\xff]*$/.test(text)), '请求头值不能含换行或非 Latin-1 字符');
export const ApiInvocationInputSchema = z.object({
  pathParameters: ApiPathParametersSchema.default({}),
  query: ApiQueryParametersSchema.default({}),
  headers: ApiInvocationHeadersSchema.default({}),
  body: z.string().max(API_INVOCATION_BODY_BYTES).refine((text) => byteLength(text) <= API_INVOCATION_BODY_BYTES, '请求体不能超过 64 KiB（UTF-8）').optional(),
}).strict();

/** 只表示网关下的具体操作路径；不允许 URL、模板占位符或 URL 归一化改变路径。 */
export const ApiInvocationPathSchema = z.string().min(1).max(API_INVOCATION_URL_BYTES).refine((path) => {
  if (!path.startsWith('/') || path.startsWith('//') || /[\\?#{}\s\x00-\x1f\x7f]/.test(path)) return false;
  try { return new URL(`http://operation.invalid${path}`).pathname === path; } catch { return false; }
}, '操作路径不合法或会被 URL 归一化改变');
export const RunnerApiInvocationSchema = ApiInvocationInputSchema.omit({ pathParameters: true }).extend({
  proxy: SlugSchema, method: HttpMethodSchema, path: ApiInvocationPathSchema,
}).strict().refine((input) => !['GET', 'HEAD'].includes(input.method) || input.body === undefined, { path: ['body'], message: 'GET／HEAD 不支持请求体' });

export const ApiInvocationResultSchema = z.object({
  status: z.number().int().min(100).max(599),
  headers: z.record(z.string().max(API_INVOCATION_HEADER_BYTES), z.string().max(API_INVOCATION_HEADER_BYTES)).refine((headers) => Object.entries(headers).reduce((bytes, [key, text]) => bytes + byteLength(key + text) + 4, 0) <= API_INVOCATION_HEADER_BYTES, '响应头超过 16 KiB'),
  /** UTF-8 文本视图；最多读取 64 KiB，二进制内容可能出现替换字符。 */
  body: z.string().max(API_INVOCATION_BODY_BYTES),
  truncated: z.boolean(), bodyTruncated: z.boolean(), headersTruncated: z.boolean(),
  durationMs: z.number().int().nonnegative(),
}).strict().refine((result) => result.truncated === (result.bodyTruncated || result.headersTruncated), '截断标记不一致');

export type RunnerApiInvocation = z.infer<typeof RunnerApiInvocationSchema>;
export type ApiInvocationResult = z.infer<typeof ApiInvocationResultSchema>;
