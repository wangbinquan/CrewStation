import { z } from 'zod';
import { SlotNameSchema } from '../events/topics';
import { ProjectIdSchema, SubtaskIdSchema, TaskIdSchema, TraceIdSchema, UserIdSchema } from '../ids';

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
  ts: z.iso.datetime(),
  source: LogSourceSchema,
  slot: SlotNameSchema.optional(),
  pod: z.string().optional(),
  stream: z.enum(['stdout', 'stderr']),
  message: z.string(),
});

export const HealthStateSchema = z.enum(['healthy', 'degraded', 'crash-looping', 'unhealthy', 'unknown']);
export const HealthDtoSchema = z.object({ slot: SlotNameSchema, state: HealthStateSchema, readyReplicas: z.number().int().min(0), replicas: z.number().int().min(0), restarts: z.number().int().min(0), lastTransitionAt: z.iso.datetime() });

export const AlertTypeSchema = z.enum(['crash-loop', 'health-failing', 'delivery-dead', 'task-failed', 'quota-exhausted', 'egress-blocked']);
export const AlertDtoSchema = z.object({ id: z.string(), projectId: ProjectIdSchema, type: AlertTypeSchema, state: z.enum(['firing', 'resolved']), detail: z.string(), firedAt: z.iso.datetime(), resolvedAt: z.iso.datetime().optional() });
export const AlertSubscriptionDtoSchema = z.object({ projectId: ProjectIdSchema, userId: UserIdSchema, channel: z.enum(['workbench', 'webhook']), target: z.string().optional() });

/** 按 traceId 回放：任务、子任务、Agent 会话、命令、产物与日志引用。 */
export const TraceReplayDtoSchema = z.object({
  traceId: TraceIdSchema,
  tasks: z.array(z.object({ taskId: TaskIdSchema, kind: z.enum(['dev-session', 'business']), createdAt: z.iso.datetime() })),
  subtasks: z.array(z.object({ subtaskId: SubtaskIdSchema, taskId: TaskIdSchema, name: z.string(), state: z.string(), sessionId: z.string().optional() })),
  sessionIds: z.array(z.string()),
  events: z.array(z.object({ at: z.iso.datetime(), type: z.string(), taskId: TaskIdSchema.optional(), subtaskId: SubtaskIdSchema.optional(), sessionId: z.string().optional(), otelTraceId: z.string().optional(), summary: z.string().optional() })),
});

export type LogQuery = z.infer<typeof LogQuerySchema>;
export type LogEntryDto = z.infer<typeof LogEntryDtoSchema>;
export type HealthDto = z.infer<typeof HealthDtoSchema>;
export type AlertDto = z.infer<typeof AlertDtoSchema>;
export type TraceReplayDto = z.infer<typeof TraceReplayDtoSchema>;
