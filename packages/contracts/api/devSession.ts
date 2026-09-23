import { ComputeProfileSelectorSchema } from './compute/computeProfile';
import { z } from 'zod';
import { ProjectIdSchema, ResourceIdSchema, TaskIdSchema, UserIdSchema } from '../ids';
import { AgentPermissionSchema } from '../manifest/tasks';
import { PREVIEW_LOG_LIMITS, PreviewLogLineSchema, PreviewStateSchema } from '../taskrunner/protocol';
import { PublishRequestSchema } from './release';
import { ApiInvocationInputSchema, ApiInvocationResultSchema } from '../taskrunner/apiInvocation';
import { DevSessionRebuildDtoSchema } from './devSessionRecovery';
import { BeforeStartStateSchema } from '../taskrunner/beforeStart';
import { StartupProgressSchema } from './progress/startupProgress';

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
  /** RFC-022：开始开发或重建的五段启动进度；升级前创建的会话没有。 */
  startup: StartupProgressSchema.optional(),
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

export const OpenDevSessionRequestSchema = z.object({
  branch: z.string().min(1),
  /** 按原分支重新开始时，失败的那个会话（RFC-022 2026-09-23 修订）：平台核对它失败在检出代码或更早后，回收它的容器与工作卷。 */
  restartOf: TaskIdSchema.optional(),
});
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
  // 没有权限字段：开发会话的 Agent 一律完全权限（D59）。
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
/**
 * 一组 CLI 标签（2026-09-23 起工作台按 Xshell 式标签组显示，每一项是一组）：`paneOrder` 是标签顺序，`activeTerminalId` 是这一组正显示的那个。
 * `name`／`layout`／`ratios` 只留给旧读者：旧工作台把一组读成一个平铺页签。
 */
export const WorkspaceTabSchema = z.object({
  id: ResourceIdSchema, name: z.string().trim().min(1).max(40), layout: z.enum(['grid', 'rows', 'columns']),
  paneOrder: z.array(PaneIdSchema).max(32),
  ratios: z.object({ columns: SplitWeightsSchema, rows: SplitWeightsSchema }).strict(),
  activeTerminalId: PaneIdSchema.optional(),
}).strict();
/** 标签组的分屏树：叶子是一组（`tabs[].id`），分支把子项左右（row）或上下（column）排开，`sizes` 是各子项的相对大小。 */
export type WorkspaceDockNode = { group: string } | { direction: 'row' | 'column'; children: WorkspaceDockNode[]; sizes: number[] };
const DockLeafSchema = z.object({ group: ResourceIdSchema }).strict();
const dockSplit = (child: z.ZodType<WorkspaceDockNode>) => z.object({ direction: z.enum(['row', 'column']), children: z.array(child).min(2).max(16), sizes: z.array(z.number().finite().min(0.01).max(100)).min(2).max(16) }).strict()
  .refine((node) => node.sizes.length === node.children.length, { message: '分屏大小与子项数量不一致', path: ['sizes'] });
/** 最多 8 层：逐层构造而不是递归引用，解析时深度就有上限。 */
export const WorkspaceDockNodeSchema: z.ZodType<WorkspaceDockNode> = Array.from({ length: 7 }).reduce<z.ZodType<WorkspaceDockNode>>((inner) => z.union([DockLeafSchema, dockSplit(inner)]), DockLeafSchema);
/** 只对自己改的 CLI 标签名；其他成员看到的仍是默认名。 */
export const WorkspaceTerminalNameSchema = z.object({ terminalId: PaneIdSchema, name: z.string().trim().min(1).max(40) }).strict();
function dockGroups(node: WorkspaceDockNode): string[] {
  return 'group' in node ? [node.group] : node.children.flatMap(dockGroups);
}
function dockNodeCount(node: WorkspaceDockNode): number {
  return 'group' in node ? 1 : 1 + node.children.reduce((sum, child) => sum + dockNodeCount(child), 0);
}
/** 工具面板（RFC-020 D1）：终端旁的一个工具及其形态；`view`／`previewAlongside` 保留给旧读者，写入时由工作台回填一致的值。 */
export const WorkspaceToolNameSchema = z.enum(['preview', 'code', 'changes', 'data', 'reference', 'session']);
export const WorkspaceToolSchema = z.object({ name: WorkspaceToolNameSchema, mode: z.enum(['side', 'full']), ratio: z.number().min(0.3).max(0.6) }).strict();
export const WorkspaceLayoutSchema = z.object({
  activeTabId: ResourceIdSchema, tabs: z.array(WorkspaceTabSchema).min(1).max(16), hiddenTerminalIds: z.array(PaneIdSchema).max(256),
  view: z.enum(['cli', 'preview', 'code', 'changes']), previewAlongside: z.boolean(), previewRatio: z.number().min(0.25).max(0.75),
  selectedTerminalId: PaneIdSchema.nullable(), maximizedTerminalId: PaneIdSchema.nullable(),
  preferredCompute: ResourceIdSchema.optional(),
  tool: WorkspaceToolSchema.optional(),
  /**
   * 标签组的分屏树；缺席时工作台按旧页签推出一棵。只校验树自身（叶子不重复、至多 64 个节点），
   * 不要求与 `tabs` 逐一对应：旧工作台增删页签时不认识这棵树，工作台读入时会补齐或剪掉。
   */
  dock: WorkspaceDockNodeSchema.optional(),
  terminalNames: z.array(WorkspaceTerminalNameSchema).max(256).optional(),
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
  if (layout.dock) {
    const groups = dockGroups(layout.dock);
    if (new Set(groups).size !== groups.length || dockNodeCount(layout.dock) > 64) ctx.addIssue({ code: 'custom', path: ['dock'], message: '分屏里每组只能出现一次，至多 64 个节点' });
  }
  const named = layout.terminalNames?.map((entry) => entry.terminalId) ?? [];
  // 名字只能起给布局里有位置的 CLI：服务端按布局核对名册时，名字引用的 CLI 因此也在名册里。
  if (new Set(named).size !== named.length || named.some((id) => !all.includes(id))) ctx.addIssue({ code: 'custom', path: ['terminalNames'], message: '每个 CLI 至多一个名字，且须在布局里' });
});
export const WorkspaceLayoutDtoSchema = z.object({ revision: z.number().int().min(0), layout: WorkspaceLayoutSchema.nullable(), updatedAt: z.iso.datetime().nullable() });
export const SaveWorkspaceLayoutRequestSchema = z.object({ expectedRevision: z.number().int().min(0), layout: WorkspaceLayoutSchema }).strict();
export type WorkspaceTab = z.infer<typeof WorkspaceTabSchema>;
export type WorkspaceLayout = z.infer<typeof WorkspaceLayoutSchema>;
export type WorkspaceTool = z.infer<typeof WorkspaceToolSchema>;
export type WorkspaceTerminalName = z.infer<typeof WorkspaceTerminalNameSchema>;
export type WorkspaceToolName = z.infer<typeof WorkspaceToolNameSchema>;
export type WorkspaceLayoutDto = z.infer<typeof WorkspaceLayoutDtoSchema>;
export type SaveWorkspaceLayoutRequest = z.infer<typeof SaveWorkspaceLayoutRequestSchema>;
