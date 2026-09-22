import { ComputeProfileSelectorSchema } from './compute/computeProfile';
import { z } from 'zod';
import { ProjectIdSchema, ResourceIdSchema, TaskIdSchema, UserIdSchema } from '../ids';
import { AgentPermissionSchema } from '../manifest/tasks';
import { PREVIEW_LOG_LIMITS, PreviewLogLineSchema, PreviewStateSchema } from '../taskrunner/protocol';
import { PublishRequestSchema } from './release';
import { ApiInvocationInputSchema, ApiInvocationResultSchema } from '../taskrunner/apiInvocation';
import { DevSessionRebuildDtoSchema } from './devSessionRecovery';
import { BeforeStartStateSchema } from '../taskrunner/beforeStart';

export const ApiInvocationRequestSchema = ApiInvocationInputSchema.extend({ expectedTaskId: TaskIdSchema, operationId: z.string().min(1).max(8192) }).strict();
export const ApiInvocationResponseSchema = z.object({ taskId: TaskIdSchema, operationId: z.string().min(1).max(8192), result: ApiInvocationResultSchema }).strict();
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
  connectionIssue: z.object({ code: z.literal('protocol_mismatch'), runnerProtocol: z.number().int().nullable(), requiredProtocol: z.number().int(), message: z.string(), at: z.iso.datetime() }).optional(),
  rebuild: DevSessionRebuildDtoSchema.optional(),
});

/**
 * RFC-016：开发会话预览进程的完整状态。`DevSessionDto.preview` 仍是会话卡片用的概要枚举，
 * 控制与诊断读这里——Runner 的 previewStatus 本来就带 restarts／lastError，此前在用例层被丢掉了。
 * 注意这是开发容器里的预览进程，不是 preview 部署槽。
 */
export const PreviewStatusDtoSchema = z.object({
  taskId: TaskIdSchema,
  state: PreviewStateSchema,
  port: z.number().int().optional(),
  restarts: z.number().int().min(0),
  lastError: z.string().optional(),
  previewHost: z.string(),
  /** 只在 ready 时给出，与工作台 previewUrl 的判定同源。 */
  url: z.string().optional(),
});

export const PreviewActionSchema = z.enum(['start', 'stop', 'restart']);

export const PreviewLogsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(PREVIEW_LOG_LIMITS.maxLines).default(PREVIEW_LOG_LIMITS.defaultLimit),
  stream: z.enum(['stdout', 'stderr']).optional(),
}).strict();

export const PreviewLogsDtoSchema = z.object({
  taskId: TaskIdSchema,
  lines: z.array(PreviewLogLineSchema),
  /** 自容器启动被挤掉的行数；非 0 说明更早的输出已经看不到了。 */
  dropped: z.number().int().min(0),
  attempt: z.number().int().min(1),
});

export type PreviewStatusDto = z.infer<typeof PreviewStatusDtoSchema>;
export type PreviewAction = z.infer<typeof PreviewActionSchema>;
export type PreviewLogsQuery = z.infer<typeof PreviewLogsQuerySchema>;
export type PreviewLogsDto = z.infer<typeof PreviewLogsDtoSchema>;

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

/** preparing：启动前 Hook 正在执行（RFC-004），不能显示成 Agent 正在执行任务。 */
export const AgentInstanceStateSchema = z.enum(['starting', 'preparing', 'running', 'awaiting-input', 'completed', 'failed', 'cancelled']);

export const AgentInstanceDtoSchema = z.object({
  agentId: z.string(),
  taskId: TaskIdSchema,
  /** 算力档位 UUID；computeName 是受理时的显示名称。 */
  compute: z.string(),
  computeName: z.string().optional(),
  permission: AgentPermissionSchema,
  state: AgentInstanceStateSchema,
  sessionId: z.string().optional(),
  /** RFC-006：此 Agent 受理时固定的档位修订。 */
  profileRevision: z.number().int().min(1).optional(),
  beforeStart: z.object({ executionId: z.string().min(1), state: BeforeStartStateSchema, currentStep: z.string().optional(), failedStep: z.string().optional(), error: z.string().optional() }).optional(),
  /**
   * RFC-006：此 Agent 独立的执行环境（每个 Agent 一个 Pod）。taskId 用来订阅它的流；message 写明排队、调度、失败的原因。
   * RFC-006 之前在开发容器里起的 Agent 没有这一项。
   */
  execution: z.object({ taskId: TaskIdSchema, state: z.enum(['queued', 'starting', 'running', 'cleaning', 'finished']), message: z.string().optional() }).optional(),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().optional(),
});

/** 开发会话内启动流式交互 Agent；算力由平台按档位分配，使用者不指定驱动与模型。 */
export const StartDevAgentRequestSchema = z.object({
  /** 算力档位 UUID 选择器或默认选择器；省略即 `default`，每次启动时解析到管理员设为默认的档位（RFC-006）。 */
  compute: ComputeProfileSelectorSchema.optional(),
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
const PaneIdSchema = ResourceIdSchema;
const SplitWeightsSchema = z.array(z.number().finite().min(0.01).max(100)).min(1).max(32);
export const WorkspaceTabSchema = z.object({
  id: ResourceIdSchema, name: z.string().trim().min(1).max(40), layout: z.enum(['grid', 'rows', 'columns']),
  paneOrder: z.array(PaneIdSchema).max(32),
  ratios: z.object({ columns: SplitWeightsSchema, rows: SplitWeightsSchema }).strict(),
}).strict();
/** 工具面板（RFC-020 D1）：终端旁的一个工具及其形态；`view`／`previewAlongside` 保留给旧读者，写入时由工作台回填一致的值。 */
export const WorkspaceToolNameSchema = z.enum(['preview', 'code', 'changes', 'data', 'reference', 'session']);
export const WorkspaceToolSchema = z.object({ name: WorkspaceToolNameSchema, mode: z.enum(['side', 'full']), ratio: z.number().min(0.3).max(0.6) }).strict();
export const WorkspaceLayoutSchema = z.object({
  activeTabId: ResourceIdSchema, tabs: z.array(WorkspaceTabSchema).min(1).max(16), hiddenTerminalIds: z.array(PaneIdSchema).max(256),
  view: z.enum(['cli', 'preview', 'code', 'changes']), previewAlongside: z.boolean(), previewRatio: z.number().min(0.25).max(0.75),
  selectedTerminalId: PaneIdSchema.nullable(), maximizedTerminalId: PaneIdSchema.nullable(),
  preferredCompute: ResourceIdSchema.optional(),
  tool: WorkspaceToolSchema.optional(),
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
export type WorkspaceTool = z.infer<typeof WorkspaceToolSchema>;
export type WorkspaceToolName = z.infer<typeof WorkspaceToolNameSchema>;
export type WorkspaceLayoutDto = z.infer<typeof WorkspaceLayoutDtoSchema>;
export type SaveWorkspaceLayoutRequest = z.infer<typeof SaveWorkspaceLayoutRequestSchema>;
