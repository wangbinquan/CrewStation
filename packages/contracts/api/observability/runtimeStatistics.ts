import { z } from 'zod';
import { RuntimeNativeCaptureSchema } from '../../taskrunner/nativeUsage';
import { ProjectIdSchema, ResourceIdSchema, ServiceIdSchema, TaskIdSchema } from '../../ids';

const at = z.iso.datetime();
const count = z.string().regex(/^(0|[1-9]\d{0,79})$/);
const amount = z.string().regex(/^(0|[1-9]\d{0,79})(\.\d{1,12})?$/).nullable();
export const RuntimeStatisticsQuerySchema = z.strictObject({ from: at, to: at, timezone: z.string().min(1).max(100).default('Asia/Shanghai'), q: z.string().max(1000).optional(), state: z.string().max(100).optional(), quality: z.string().max(100).optional() })
  .refine((q) => Date.parse(q.from) < Date.parse(q.to), { message: '统计开始时间必须早于结束时间' })
  .refine((q) => { try { new Intl.DateTimeFormat('en', { timeZone: q.timezone }); return true; } catch { return false; } }, { message: '时区无效' });
export type RuntimeStatisticsQuery = z.infer<typeof RuntimeStatisticsQuerySchema>;

/** Owner facts contain no prompt, output, command, credentials or configured internal model. */
export const RuntimeAttemptFactSchema = z.strictObject({
  id: ResourceIdSchema, taskId: TaskIdSchema, name: z.string(), kind: z.enum(['agent', 'command']),
  state: z.string(), attempt: z.number().int().positive(), executionId: ResourceIdSchema.nullable(),
  agentId: ResourceIdSchema.nullable(), profileId: ResourceIdSchema.nullable(), profileRevision: z.number().int().nonnegative().nullable(),
  createdAt: at, startedAt: at.nullable(), endedAt: at.nullable(),
});
export const RuntimeTaskFactSchema = z.strictObject({
  id: TaskIdSchema, projectId: ProjectIdSchema, serviceId: ServiceIdSchema, name: z.string(),
  protocol: z.enum(['legacy', 'v3']), state: z.string(), createdAt: at, closedAt: at.nullable(),
  traceId: z.string().nullable(), attempts: z.array(RuntimeAttemptFactSchema), attemptsPartial: z.boolean(),
});
export type RuntimeAttemptFact = z.infer<typeof RuntimeAttemptFactSchema>;
export type RuntimeTaskFact = z.infer<typeof RuntimeTaskFactSchema>;
export interface RuntimeFactQuery extends RuntimeStatisticsQuery { projectId?: string; taskId?: string }
export interface RuntimeFactPage { items: RuntimeTaskFact[]; partial: boolean }

export const RuntimeUsageMetricsSchema = z.strictObject({
  tokens: z.strictObject({ input: count, cacheRead: count, cacheWrite: count, output: count, total: count, hasKnown: z.boolean(), complete: z.boolean(),
    unknownBuckets: z.strictObject({ input: z.number().int().nonnegative(), cacheRead: z.number().int().nonnegative(), cacheWrite: z.number().int().nonnegative(), output: z.number().int().nonnegative() }),
  }),
  cost: z.strictObject({ currency: z.literal('CNY'), amount, complete: z.boolean(), visible: z.boolean() }),
  executions: z.number().int().nonnegative(), observedExecutions: z.number().int().nonnegative(), records: z.number().int().nonnegative(),
  reasons: z.array(z.string()), partial: z.boolean(),
}).refine((m) => m.cost.visible || m.cost.amount === null && !m.cost.complete, { message: '未开放费用不得包含金额或完整估值' });
export type RuntimeUsageMetrics = z.infer<typeof RuntimeUsageMetricsSchema>;
export const RuntimeTaskSummarySchema = RuntimeTaskFactSchema.omit({ attempts: true }).extend({
  attemptCount: z.number().int().nonnegative(), metrics: RuntimeUsageMetricsSchema, wallMs: z.number().nonnegative().nullable(),
  cumulativeMs: z.number().nonnegative(), activeUnionMs: z.number().nonnegative(), unknownIntervals: z.number().int().nonnegative(),
});
export const RuntimeAttemptSummarySchema = RuntimeAttemptFactSchema.extend({ nativeCaptures: z.array(RuntimeNativeCaptureSchema).max(2000).optional(), metrics: RuntimeUsageMetricsSchema, durationMs: z.number().nonnegative().nullable(), open: z.boolean() });
export const RuntimeTaskObservationSchema = RuntimeTaskSummarySchema.extend({
  scope: z.enum(['project', 'system']), asOf: at, attempts: z.array(RuntimeAttemptSummarySchema), partial: z.boolean(),
});
export type RuntimeTaskSummary = z.infer<typeof RuntimeTaskSummarySchema>;
export type RuntimeAttemptSummary = z.infer<typeof RuntimeAttemptSummarySchema>;
export type RuntimeTaskObservation = z.infer<typeof RuntimeTaskObservationSchema>;
export const RuntimeAgentStatisticsSchema = z.strictObject({
  key: z.string(), projectId: ProjectIdSchema, agentId: ResourceIdSchema.nullable(), profileId: ResourceIdSchema.nullable(), profileRevision: z.number().int().nonnegative().nullable(),
  kind: z.enum(['agent', 'command']), name: z.string(), metrics: RuntimeUsageMetricsSchema,
  tasks: z.array(z.strictObject({ taskId: TaskIdSchema, metrics: RuntimeUsageMetricsSchema, attempts: z.number().int().nonnegative() })),
});
export type RuntimeAgentStatistics = z.infer<typeof RuntimeAgentStatisticsSchema>;
const common = {
  asOf: at, projectionVersion: z.literal(1), cohort: z.literal('started'), filters: RuntimeStatisticsQuerySchema,
  partial: z.boolean(), limits: z.strictObject({ tasks: z.number(), attempts: z.number(), records: z.number() }),
  metrics: RuntimeUsageMetricsSchema, tasks: z.array(RuntimeTaskSummarySchema), agents: z.array(RuntimeAgentStatisticsSchema),
  projects: z.array(z.strictObject({ projectId: ProjectIdSchema, tasks: z.number(), metrics: RuntimeUsageMetricsSchema })),
  trend: z.array(z.strictObject({ from: at, to: at, tasks: z.number(), metrics: RuntimeUsageMetricsSchema })),
  durations: z.strictObject({ samples: z.number().int().nonnegative(), p50Ms: z.number().nullable(), p95Ms: z.number().nullable(), maxMs: z.number().nullable() }),
  quality: z.array(z.strictObject({ reason: z.string(), taskIds: z.array(TaskIdSchema) })),
  /** First release covers business executions; other source kinds remain separately reported by their owners. */
  sourceScope: z.literal('business-tasks'),
};
export const ProjectRuntimeStatisticsSchema = z.strictObject({ ...common, scope: z.literal('project'), projectId: ProjectIdSchema });
export const SystemRuntimeStatisticsSchema = z.strictObject({ ...common, scope: z.literal('system'),
  models: z.array(z.strictObject({ modelRef: z.string().nullable(), metrics: RuntimeUsageMetricsSchema })),
  profiles: z.array(z.strictObject({ profileId: ResourceIdSchema.nullable(), profileRevision: z.number().nullable(), metrics: RuntimeUsageMetricsSchema })),
});
export type ProjectRuntimeStatistics = z.infer<typeof ProjectRuntimeStatisticsSchema>;
export type SystemRuntimeStatistics = z.infer<typeof SystemRuntimeStatisticsSchema>;
export type RuntimeStatistics = ProjectRuntimeStatistics | SystemRuntimeStatistics;

/** Synchronous export is bounded by the same read budget as the formal statistics page. */
export const RuntimeExportQuerySchema = z.strictObject({
  window: RuntimeStatisticsQuerySchema, view: z.enum(['tasks', 'agents']),
  q: z.string().max(1000).optional(), state: z.string().max(100).optional(), quality: z.string().max(100).optional(), agent: z.string().max(1000).optional(),
});
export const RuntimeExportSchema = z.strictObject({
  filename: z.string(), mediaType: z.literal('text/csv;charset=utf-8'), content: z.string(),
  asOf: at, rows: z.number().int().nonnegative().max(2000), partial: z.boolean(), bounded: z.literal(true),
});
export type RuntimeExportQuery = z.infer<typeof RuntimeExportQuerySchema>;
export type RuntimeExport = z.infer<typeof RuntimeExportSchema>;
