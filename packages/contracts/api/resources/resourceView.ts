import { z } from 'zod';
import { ProjectIdSchema, ResourceIdSchema } from '../../ids';
import { ResourceActionIdSchema, ResourceKindSchema, ResourceRecordSchema } from './resourceRecord';

/**
 * RFC-025 的资源视图：一次快照（带游标）＋推送流（增量）。计数由服务端按「种类 × 阶段」算好，页面不再自己数。
 * 游标是资源中心变更日志的序号：断线凭它续传，过旧时服务端重新给快照。
 */
export const ResourceCountsSchema = z.record(z.string(), z.record(z.string(), z.number().int().nonnegative()));

export const ResourceViewQuerySchema = z.object({
  kind: ResourceKindSchema.optional(),
  parent: ResourceIdSchema.optional(),
  /** 带上已结束（`stopped`）的记录；缺省只给在运行、结束中与失败保留中的。 */
  includeStopped: z.enum(['true', 'false']).default('false'),
}).strict();

export const AdminResourceViewQuerySchema = ResourceViewQuerySchema.extend({ projectId: ProjectIdSchema.optional() }).strict();

export const ResourceViewSchema = z.object({
  items: z.array(ResourceRecordSchema),
  counts: ResourceCountsSchema,
  cursor: z.number().int().nonnegative(),
});

/** SSE 事件：`event:` 行是 type，`id:` 行是 cursor（heartbeat 与 reset 不带 id）。 */
export const ResourceStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('snapshot'), items: z.array(ResourceRecordSchema), counts: ResourceCountsSchema, cursor: z.number().int().nonnegative() }),
  z.object({ type: z.literal('upsert'), record: ResourceRecordSchema, counts: ResourceCountsSchema, cursor: z.number().int().nonnegative() }),
  z.object({ type: z.literal('remove'), id: ResourceIdSchema, counts: ResourceCountsSchema, cursor: z.number().int().nonnegative() }),
  z.object({ type: z.literal('heartbeat'), at: z.iso.datetime() }),
  z.object({ type: z.literal('reset'), reason: z.string().max(200) }),
]);

export const ResourceProjectParamsSchema = z.object({ projectId: ProjectIdSchema }).strict();
/** 续传游标：SSE 的 Last-Event-ID 头或 `cursor` 查询参数（EventSource 不能自定义头时用）。 */
export const ResourceStreamCursorSchema = z.coerce.number().int().nonnegative();

export const ResourceActionParamsSchema = z.object({ resourceId: ResourceIdSchema, action: ResourceActionIdSchema }).strict();
/** 可做操作的受理：只带确认所需的最少信息；领域规则（例如释放会话的未推送检查）由所属模块执行。 */
export const ResourceActionRequestSchema = z.object({ force: z.boolean().optional(), expectedVersion: z.number().int().nonnegative().optional() }).strict();
export const ResourceActionResultSchema = z.object({ record: ResourceRecordSchema.optional(), accepted: z.boolean() });

export type ResourceCounts = z.infer<typeof ResourceCountsSchema>;
export type ResourceViewQuery = z.input<typeof ResourceViewQuerySchema>;
export type AdminResourceViewQuery = z.input<typeof AdminResourceViewQuerySchema>;
export type ResourceView = z.infer<typeof ResourceViewSchema>;
export type ResourceStreamEvent = z.infer<typeof ResourceStreamEventSchema>;
export type ResourceActionRequest = z.infer<typeof ResourceActionRequestSchema>;
export type ResourceActionResult = z.infer<typeof ResourceActionResultSchema>;

/** 计数里取一个格子：没有就是 0（计数是服务端对全部在列记录算的，缺格即没有）。 */
export function resourceCount(counts: ResourceCounts, kind: string, phases: readonly string[]): number {
  const byPhase = counts[kind] ?? {};
  return phases.reduce((sum, phase) => sum + (byPhase[phase] ?? 0), 0);
}
