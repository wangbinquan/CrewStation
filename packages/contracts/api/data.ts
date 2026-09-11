import { z } from 'zod';
import { ProjectIdSchema, TaskIdSchema, UserIdSchema } from '../ids';

export const DataResourceKindSchema = z.enum(['postgres', 's3', 'pvc']);
export const DataEnvSchema = z.enum(['production', 'development']);
export const DataResourceStateSchema = z.enum(['requested', 'provisioning', 'ready', 'failed', 'releasing', 'released']);

export const DataResourceDtoSchema = z.object({
  id: z.string(),
  projectId: ProjectIdSchema,
  kind: DataResourceKindSchema,
  env: DataEnvSchema,
  plan: z.string(),
  state: DataResourceStateSchema,
  /** 约定的环境变量名，值只注入容器。 */
  envVar: z.string(),
  message: z.string().optional(),
  createdAt: z.iso.datetime(),
});

export const TaskDataModeSchema = z.enum(['development', 'diagnostic-readonly', 'production-change']);
export const TaskDataBindingStateSchema = z.enum(['requested', 'approved', 'rejected', 'active', 'expired', 'revoked']);

/** 开发会话内申请数据访问模式；后两种需负责人批准（R34）。 */
export const RequestTaskDataBindingSchema = z.object({
  mode: TaskDataModeSchema,
  reason: z.string().max(500).optional(),
  /** 批准后的有效时长。 */
  ttlMinutes: z.number().int().min(5).max(24 * 60).default(120),
});

export const TaskDataBindingDtoSchema = z.object({
  id: z.string(),
  taskId: TaskIdSchema,
  mode: TaskDataModeSchema,
  state: TaskDataBindingStateSchema,
  reason: z.string().optional(),
  decision: z.string().optional(),
  requestedBy: UserIdSchema,
  decidedBy: UserIdSchema.optional(),
  expiresAt: z.iso.datetime().optional(),
  createdAt: z.iso.datetime(),
});

export const DecideTaskDataBindingSchema = z.object({ approve: z.boolean(), decision: z.string().max(500).optional() });

export type DataResourceDto = z.infer<typeof DataResourceDtoSchema>;
export type TaskDataMode = z.infer<typeof TaskDataModeSchema>;
export type TaskDataBindingDto = z.infer<typeof TaskDataBindingDtoSchema>;
