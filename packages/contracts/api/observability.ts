import { z } from 'zod';
import { SlotNameSchema } from '../events/topics';
import { ProjectIdSchema, TaskIdSchema } from '../ids';

export const LogSourceSchema = z.enum(['slot', 'dev-session', 'business-task', 'build', 'migration']);

export const LogQuerySchema = z.object({
  source: LogSourceSchema,
  slot: SlotNameSchema.optional(),
  taskId: TaskIdSchema.optional(),
  releaseId: z.string().optional(),
  since: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(2000).default(500),
  cursor: z.string().optional(),
});

export const LogEntryDtoSchema = z.object({
  /** 容器日志的发生时间；缺失时不能用查询时间补造。 */
  ts: z.iso.datetime().optional(),
  source: LogSourceSchema,
  slot: SlotNameSchema.optional(),
  pod: z.string().optional(),
  /** combined 表示来源未逐行区分标准输出和标准错误。 */
  stream: z.enum(['stdout', 'stderr', 'combined']),
  message: z.string(),
});

export const HealthStateSchema = z.enum(['healthy', 'degraded', 'crash-looping', 'unhealthy', 'unknown']);
export const HealthDtoSchema = z.object({ slot: SlotNameSchema, state: HealthStateSchema, readyReplicas: z.number().int().min(0), replicas: z.number().int().min(0), restarts: z.number().int().min(0), lastTransitionAt: z.iso.datetime() });

/** 首版只有两槽健康巡检这一个告警来源（D61）。 */
export const AlertTypeSchema = z.enum(['crash-loop', 'health-failing']);
export const AlertDtoSchema = z.object({ id: z.string(), projectId: ProjectIdSchema, type: AlertTypeSchema, state: z.enum(['firing', 'resolved']), detail: z.string(), firedAt: z.iso.datetime(), resolvedAt: z.iso.datetime().optional(), slot: SlotNameSchema.optional() });

export type LogSource = z.infer<typeof LogSourceSchema>;
export type HealthState = z.infer<typeof HealthStateSchema>;
export type AlertType = z.infer<typeof AlertTypeSchema>;
export type LogQuery = z.infer<typeof LogQuerySchema>;
export type LogEntryDto = z.infer<typeof LogEntryDtoSchema>;
export type HealthDto = z.infer<typeof HealthDtoSchema>;
export type AlertDto = z.infer<typeof AlertDtoSchema>;
