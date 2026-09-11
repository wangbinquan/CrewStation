import { z } from 'zod';
import { ServiceIdSchema, SlugSchema, SubtaskIdSchema, TaskIdSchema, TraceIdSchema } from '../ids';
import { VolumeModeSchema } from '../manifest/tasks';

export const BusinessTaskStateSchema = z.enum(['creating', 'running', 'paused', 'closing', 'closed', 'failed']);

export const CreateBusinessTaskRequestSchema = z.object({
  volumeMode: VolumeModeSchema.optional(),
  profile: SlugSchema.optional(),
  /** 由事件触发时延续事件的 traceId。 */
  traceId: TraceIdSchema.optional(),
  labels: z.record(z.string(), z.string()).default({}),
});

export const BusinessTaskDtoSchema = z.object({
  id: TaskIdSchema,
  serviceId: ServiceIdSchema,
  state: BusinessTaskStateSchema,
  traceId: TraceIdSchema,
  volumeMode: VolumeModeSchema,
  profile: SlugSchema,
  podName: z.string().optional(),
  labels: z.record(z.string(), z.string()),
  createdAt: z.iso.datetime(),
  closedAt: z.iso.datetime().optional(),
  message: z.string().optional(),
});

export const SubtaskModeSchema = z.enum(['oneshot', 'interactive']);
export const SubtaskStateSchema = z.enum(['pending', 'running', 'awaiting-input', 'verifying', 'succeeded', 'failed', 'cancelled']);

/** 子任务提交：Agent 子任务引用 Manifest 登记的 agentProfile 与 outputContract；命令子任务直接给命令。 */
export const SubmitSubtaskRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('agent'),
    name: SlugSchema,
    agentProfile: SlugSchema,
    outputContract: SlugSchema.optional(),
    mode: SubtaskModeSchema.default('oneshot'),
    prompt: z.string().min(1),
    cwd: z.string().optional(),
    resumeSessionId: z.string().optional(),
  }),
  z.object({
    kind: z.literal('command'),
    name: SlugSchema,
    command: z.array(z.string().min(1)).min(1),
    cwd: z.string().optional(),
    timeoutSeconds: z.number().int().min(1).max(86400).default(3600),
  }),
]);

export const SubtaskDtoSchema = z.object({
  id: SubtaskIdSchema,
  taskId: TaskIdSchema,
  name: SlugSchema,
  kind: z.enum(['agent', 'command']),
  mode: SubtaskModeSchema.optional(),
  state: SubtaskStateSchema,
  attempt: z.number().int().min(1),
  agentProfile: SlugSchema.optional(),
  outputContract: SlugSchema.optional(),
  /** 业务语义结果，由业务程序或契约校验写入，不等于成功与否。 */
  businessOutcome: z.string().optional(),
  sessionId: z.string().optional(),
  exitCode: z.number().int().optional(),
  contractResult: z.object({ ok: z.boolean(), missing: z.array(z.string()), schemaErrors: z.array(z.string()) }).optional(),
  startedAt: z.iso.datetime().optional(),
  endedAt: z.iso.datetime().optional(),
  error: z.string().optional(),
});

export const SubtaskMessageRequestSchema = z.object({ content: z.string().min(1) });

export type BusinessTaskDto = z.infer<typeof BusinessTaskDtoSchema>;
export type BusinessTaskState = z.infer<typeof BusinessTaskStateSchema>;
export type CreateBusinessTaskRequest = z.infer<typeof CreateBusinessTaskRequestSchema>;
export type SubmitSubtaskRequest = z.infer<typeof SubmitSubtaskRequestSchema>;
export type SubtaskDto = z.infer<typeof SubtaskDtoSchema>;
export type SubtaskState = z.infer<typeof SubtaskStateSchema>;
export type SubtaskMode = z.infer<typeof SubtaskModeSchema>;
export type SubtaskMessageRequest = z.infer<typeof SubtaskMessageRequestSchema>;
