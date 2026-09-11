import { z } from 'zod';
import { ProjectIdSchema, TaskIdSchema, UserIdSchema } from '../ids';
import { AgentDriverSchema, AgentPermissionSchema } from '../manifest/tasks';
import { PreviewStateSchema } from '../taskrunner/protocol';

export const DevSessionStateSchema = z.enum(['creating', 'running', 'releasing', 'released', 'failed']);

export const DevSessionDtoSchema = z.object({
  taskId: TaskIdSchema,
  projectId: ProjectIdSchema,
  state: DevSessionStateSchema,
  branch: z.string(),
  podName: z.string().optional(),
  previewHost: z.string(),
  preview: PreviewStateSchema,
  createdBy: UserIdSchema,
  createdAt: z.iso.datetime(),
  lastActivityAt: z.iso.datetime(),
  idleReminderSentAt: z.iso.datetime().optional(),
  message: z.string().optional(),
});

export const OpenDevSessionRequestSchema = z.object({ branch: z.string().min(1) });

/** 分支列表：各分支 HEAD 与两槽部署提交的落后数，供开会话前选择。 */
export const BranchDtoSchema = z.object({
  name: z.string(),
  headSha: z.string(),
  isDefault: z.boolean(),
  behindPreview: z.number().int().min(0).nullable(),
  behindProd: z.number().int().min(0).nullable(),
});

export const AgentInstanceStateSchema = z.enum(['starting', 'running', 'awaiting-input', 'completed', 'failed', 'cancelled']);

export const AgentInstanceDtoSchema = z.object({
  agentId: z.string(),
  taskId: TaskIdSchema,
  driver: AgentDriverSchema,
  model: z.string(),
  permission: AgentPermissionSchema,
  state: AgentInstanceStateSchema,
  sessionId: z.string().optional(),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().optional(),
});

/** 开发会话内启动流式交互 Agent；使用者决定用哪个驱动与模型。 */
export const StartDevAgentRequestSchema = z.object({
  driver: AgentDriverSchema,
  model: z.string().min(1),
  permission: AgentPermissionSchema.default('edit'),
  prompt: z.string().min(1),
  cwd: z.string().optional(),
  resumeSessionId: z.string().optional(),
});

export const SendAgentMessageRequestSchema = z.object({ content: z.string().min(1) });

export type DevSessionDto = z.infer<typeof DevSessionDtoSchema>;
export type DevSessionState = z.infer<typeof DevSessionStateSchema>;
export type BranchDto = z.infer<typeof BranchDtoSchema>;
export type AgentInstanceDto = z.infer<typeof AgentInstanceDtoSchema>;
export type AgentInstanceState = z.infer<typeof AgentInstanceStateSchema>;
export type StartDevAgentRequest = z.infer<typeof StartDevAgentRequestSchema>;
