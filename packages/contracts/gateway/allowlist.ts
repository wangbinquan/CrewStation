import { z } from 'zod';
import { ServiceIdentitySchema } from './identity';

/**
 * 网关放行表：按调用方服务身份列出允许的操作键（`<proxy>:<METHOD>:<path>`）。
 * 由 gateway 模块从 api-catalog 的 Grant 与开放策略生成，带版本下发；服务域每个请求都按它判定。
 */
export const AllowlistEntrySchema = z.object({
  caller: ServiceIdentitySchema,
  operations: z.array(z.string().min(1)),
  /** 允许调用平台 API（创建业务任务等）；所有已发布服务默认 true。 */
  platformApi: z.boolean().default(true),
  /**
   * 可达的平台服务域端点。两个 MCP 对所有已登记服务开放（开发容器内的 Agent 要连）；
   * 事件入口只对 EventProducer 开放——别的服务不该能凭空造事件。
   */
  platformHosts: z.array(z.enum(['platformApi', 'events', 'mcpCapabilities', 'mcpOperations'])).default([]),
});

export const AllowlistDocumentSchema = z.object({
  version: z.number().int().min(0),
  generatedAt: z.iso.datetime(),
  /** 默认开放的操作键，对所有调用方生效。 */
  defaultOpen: z.array(z.string().min(1)),
  entries: z.array(AllowlistEntrySchema),
  /** 失联时按最后一版继续放行的最长时间；超过后拒绝。 */
  maxStaleSeconds: z.number().int().min(1),
});

/** 路径模板匹配：`/v1/issues/{id}` 匹配 `/v1/issues/42`。 */
export function matchesOperationPath(template: string, path: string): boolean {
  const t = template.split('/');
  const p = path.split('?')[0]?.split('/') ?? [];
  if (t.length !== p.length) return false;
  return t.every((seg, i) => seg.startsWith('{') && seg.endsWith('}') ? (p[i] ?? '').length > 0 : seg === p[i]);
}

export type AllowlistEntry = z.infer<typeof AllowlistEntrySchema>;
export type AllowlistDocument = z.infer<typeof AllowlistDocumentSchema>;
