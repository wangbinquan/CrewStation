import { z } from 'zod';
import { ProjectIdSchema, SlugSchema, TaskIdSchema, UserIdSchema } from '../ids';
import { AgentPermissionSchema } from '../manifest/tasks';
import { PreviewStateSchema } from '../taskrunner/protocol';
import { PublishRequestSchema } from './release';
import { ApiInvocationInputSchema, ApiInvocationResultSchema } from '../taskrunner/apiInvocation';
import { DevSessionRebuildDtoSchema } from './devSessionRecovery';

export const ApiInvocationRequestSchema = ApiInvocationInputSchema.extend({ expectedTaskId: TaskIdSchema, operationKey: z.string().min(1).max(8192) }).strict();
export const ApiInvocationResponseSchema = z.object({ taskId: TaskIdSchema, operationKey: z.string().min(1).max(8192), result: ApiInvocationResultSchema }).strict();
export type ApiInvocationRequest = z.infer<typeof ApiInvocationRequestSchema>;
export type ApiInvocationResponse = z.infer<typeof ApiInvocationResponseSchema>;

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
  rebuild: DevSessionRebuildDtoSchema.optional(),
});

export const OpenDevSessionRequestSchema = z.object({ branch: z.string().min(1) });
export const PublishDevSessionRequestSchema = PublishRequestSchema.extend({ expectedTaskId: TaskIdSchema.optional() });
export type PublishDevSessionRequest = z.infer<typeof PublishDevSessionRequestSchema>;

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
  /** 算力档位名；租户面不展示背后的驱动与模型（RFC-001）。 */
  compute: z.string(),
  permission: AgentPermissionSchema,
  state: AgentInstanceStateSchema,
  sessionId: z.string().optional(),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().optional(),
});

/** 开发会话内启动流式交互 Agent；算力由平台按档位分配，使用者不指定驱动与模型。 */
export const StartDevAgentRequestSchema = z.object({
  /** 管理员定义的算力档位名；省略时用平台默认档（RFC-001）。 */
  compute: SlugSchema.optional(),
  permission: AgentPermissionSchema.default('edit'),
  prompt: z.string().min(1),
  cwd: z.string().optional(),
  resumeSessionId: z.string().optional(),
});

export const SendAgentMessageRequestSchema = z.object({ content: z.string().min(1) });

export type DevSessionDto = z.infer<typeof DevSessionDtoSchema>;
export type OpenDevSessionRequest = z.infer<typeof OpenDevSessionRequestSchema>;
export type SendAgentMessageRequest = z.infer<typeof SendAgentMessageRequestSchema>;
export type DevSessionState = z.infer<typeof DevSessionStateSchema>;
export type BranchDto = z.infer<typeof BranchDtoSchema>;
export type AgentInstanceDto = z.infer<typeof AgentInstanceDtoSchema>;
export type AgentInstanceState = z.infer<typeof AgentInstanceStateSchema>;
export type StartDevAgentRequest = z.infer<typeof StartDevAgentRequestSchema>;

/** 个人显示配置；不保存终端输出，不拥有进程生命周期。 */
const PaneIdSchema = z.string().min(1).max(128);
const SplitWeightsSchema = z.array(z.number().finite().min(0.01).max(100)).min(1).max(32);
export const WorkspaceTabSchema = z.object({
  id: z.uuid(), name: z.string().trim().min(1).max(40), layout: z.enum(['grid', 'rows', 'columns']),
  paneOrder: z.array(PaneIdSchema).max(32),
  ratios: z.object({ columns: SplitWeightsSchema, rows: SplitWeightsSchema }).strict(),
}).strict();
export const WorkspaceLayoutSchema = z.object({
  activeTabId: z.uuid(), tabs: z.array(WorkspaceTabSchema).min(1).max(16), hiddenTerminalIds: z.array(PaneIdSchema).max(256),
  view: z.enum(['cli', 'preview', 'code', 'changes']), previewAlongside: z.boolean(), previewRatio: z.number().min(0.25).max(0.75),
  selectedTerminalId: PaneIdSchema.nullable(), maximizedTerminalId: PaneIdSchema.nullable(),
  preferredCompute: SlugSchema.optional(),
}).strict().superRefine((layout, ctx) => {
  const ids = layout.tabs.map((tab) => tab.id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['tabs'], message: '页签 ID 不能重复' });
  if (!ids.includes(layout.activeTabId)) ctx.addIssue({ code: 'custom', path: ['activeTabId'], message: '当前页签不存在' });
  const panes = layout.tabs.flatMap((tab) => tab.paneOrder);
  const all = [...panes, ...layout.hiddenTerminalIds];
  if (new Set(all).size !== all.length || all.length > 256) ctx.addIssue({ code: 'custom', path: ['tabs'], message: '每个 CLI 只能放在一个位置，最多 256 个' });
  for (const key of ['selectedTerminalId', 'maximizedTerminalId'] as const) {
    if (layout[key] && !panes.includes(layout[key])) ctx.addIssue({ code: 'custom', path: [key], message: '显示窗不存在' });
  }
});
export const WorkspaceLayoutDtoSchema = z.object({ revision: z.number().int().min(0), layout: WorkspaceLayoutSchema.nullable(), updatedAt: z.iso.datetime().nullable() });
export const SaveWorkspaceLayoutRequestSchema = z.object({ expectedRevision: z.number().int().min(0), layout: WorkspaceLayoutSchema }).strict();
export type WorkspaceTab = z.infer<typeof WorkspaceTabSchema>;
export type WorkspaceLayout = z.infer<typeof WorkspaceLayoutSchema>;
export type WorkspaceLayoutDto = z.infer<typeof WorkspaceLayoutDtoSchema>;
export type SaveWorkspaceLayoutRequest = z.infer<typeof SaveWorkspaceLayoutRequestSchema>;
