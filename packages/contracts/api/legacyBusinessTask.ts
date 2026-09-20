/** Explicit protocol v1 surface retained for already published business applications. */
import { z } from 'zod';
import { SlugSchema, TraceIdSchema } from '../ids';
const legacyId = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[0-9a-f]{32}$`));
const ServiceIdSchema = legacyId('svc'), TaskIdSchema = legacyId('tsk'), SubtaskIdSchema = legacyId('sub');
import { VolumeModeSchema } from '../manifest/tasks';

export const LegacyBusinessTaskStateSchema = z.enum(['creating', 'running', 'paused', 'closing', 'closed', 'failed']);

export const LegacyCreateBusinessTaskRequestSchema = z.object({
  volumeMode: VolumeModeSchema.optional(),
  profile: SlugSchema.optional(),
  /** 由事件触发时延续事件的 traceId。 */
  traceId: TraceIdSchema.optional(),
  labels: z.record(z.string(), z.string()).default({}),
});

export const LegacyBusinessTaskDtoSchema = z.object({
  id: TaskIdSchema,
  serviceId: ServiceIdSchema,
  state: LegacyBusinessTaskStateSchema,
  traceId: TraceIdSchema,
  volumeMode: VolumeModeSchema,
  profile: SlugSchema,
  podName: z.string().optional(),
  labels: z.record(z.string(), z.string()),
  createdAt: z.iso.datetime(),
  closedAt: z.iso.datetime().optional(),
  message: z.string().optional(),
});

export const LegacySubtaskModeSchema = z.enum(['oneshot', 'interactive']);
export const LegacySubtaskStateSchema = z.enum(['pending', 'running', 'awaiting-input', 'verifying', 'succeeded', 'failed', 'cancelled']);

/** 子任务提交：Agent 子任务引用 Manifest 登记的 agentProfile 与 outputContract；命令子任务直接给命令。 */
export const LegacySubmitSubtaskRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('agent'),
    name: SlugSchema,
    agentProfile: SlugSchema,
    outputContract: SlugSchema.optional(),
    mode: LegacySubtaskModeSchema.default('oneshot'),
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

export const LegacySubtaskDtoSchema = z.object({
  id: SubtaskIdSchema,
  taskId: TaskIdSchema,
  name: SlugSchema,
  kind: z.enum(['agent', 'command']),
  mode: LegacySubtaskModeSchema.optional(),
  state: LegacySubtaskStateSchema,
  attempt: z.number().int().min(1),
  agentProfile: SlugSchema.optional(),
  outputContract: SlugSchema.optional(),
  /** 业务语义结果，由业务程序或契约校验写入，不等于成功与否。 */
  businessOutcome: z.string().optional(),
  sessionId: z.string().optional(),
  exitCode: z.number().int().optional(),
  contractResult: z.object({ ok: z.boolean(), missing: z.array(z.string()), schemaErrors: z.array(z.string()) }).optional(),
  /** RFC-006：本次 Agent 子任务受理时固定的档位（`default` 已解析为真实名称）与修订。 */
  compute: z.string().optional(),
  profileRevision: z.number().int().min(1).optional(),
  startedAt: z.iso.datetime().optional(),
  endedAt: z.iso.datetime().optional(),
  error: z.string().optional(),
});

export const LegacySubtaskMessageRequestSchema = z.object({ content: z.string().min(1) });

export type LegacyBusinessTaskDto = z.infer<typeof LegacyBusinessTaskDtoSchema>;
export type LegacyBusinessTaskState = z.infer<typeof LegacyBusinessTaskStateSchema>;
export type LegacyCreateBusinessTaskRequest = z.infer<typeof LegacyCreateBusinessTaskRequestSchema>;
export type LegacySubmitSubtaskRequest = z.infer<typeof LegacySubmitSubtaskRequestSchema>;
export type LegacySubtaskDto = z.infer<typeof LegacySubtaskDtoSchema>;
export type LegacySubtaskState = z.infer<typeof LegacySubtaskStateSchema>;
export type LegacySubtaskMode = z.infer<typeof LegacySubtaskModeSchema>;
export type LegacySubtaskMessageRequest = z.infer<typeof LegacySubtaskMessageRequestSchema>;
