import type { AgentInstanceDto, BranchDto, DevSessionDto, OpenDevSessionRequest, ReleaseDto, SendAgentMessageRequest, StartDevAgentRequest, WorkspaceStatusDto } from '@crewstation/contracts';
import type { ComparisonDetailQuery, ComparisonDetails, ComparisonTarget, VersionComparisonDto } from '@crewstation/contracts';
import type { NativeTerminalDto, NativeTerminalList, NativeTerminalSnapshotDto, StartNativeTerminalRequest } from '@crewstation/contracts';
import type { SaveWorkspaceLayoutRequest, WorkspaceLayoutDto } from '@crewstation/contracts';
import type { AgentActivityPage, AgentActivityQuery, ReadAgentActivityRequest } from '@crewstation/contracts';
import type { ApiInvocationRequest, ApiInvocationResponse } from '@crewstation/contracts';
import type { DevSessionRebuildDto, DevSessionRebuildInspection, RebuildDevSessionRequest } from '@crewstation/contracts';
import type { PreviewAction, PreviewLogsDto, PreviewLogsQuery, PreviewStatusDto } from '@crewstation/contracts';
import { API_INVOCATION_TIMEOUT_MS } from '@crewstation/contracts';
import type { Transport } from '../httpTransport';
import type { ItemsPage } from '../itemsPage';
import type { PublishDevSessionInput } from '../requestInputs';
import { segment } from '../requestUrl';

/** DELETE /v1/projects/:projectId/dev-session 的响应：释放后的会话与容器里尚未推送的提交（`<sha> <subject>`）。 */
export interface ReleaseDevSessionResult {
  readonly session: DevSessionDto;
  /** null 表示无法确认，不能把它当作已全部推送。 */
  readonly unpushed: string[] | null;
  readonly workspace: WorkspaceStatusDto;
}

export interface ReleaseDevSessionOptions {
  /** 负责人强制释放他人会话时必须为 true。 */
  readonly force?: boolean;
  /** 只释放用户刚刚确认的会话；期间被替换时返回 precondition。 */
  readonly expectedTaskId?: string;
}

/** 开发会话：一项目一会话、分支与落后数、并行流式 Agent、从会话发布。 */
export interface DevSessionResource {
  inspectRebuild(projectId: string): Promise<DevSessionRebuildInspection>;
  rebuild(projectId: string, input: RebuildDevSessionRequest): Promise<DevSessionRebuildDto>;
  invokeApi(projectId: string, input: ApiInvocationRequest): Promise<ApiInvocationResponse>;
  getAgentActivity(taskId: string, query?: AgentActivityQuery): Promise<AgentActivityPage>;
  readAgentActivity(taskId: string, input: ReadAgentActivityRequest): Promise<{ throughSeq: number }>;
  /** `signal`：调用方给读写设上限（个人布局存储每次最多等 15 秒）。 */
  getWorkspaceLayout(taskId: string, options?: { readonly signal?: AbortSignal }): Promise<WorkspaceLayoutDto>;
  saveWorkspaceLayout(taskId: string, input: SaveWorkspaceLayoutRequest, options?: { readonly signal?: AbortSignal }): Promise<WorkspaceLayoutDto>;
  listNativeTerminals(taskId: string): Promise<NativeTerminalList>;
  startNativeTerminal(taskId: string, input: StartNativeTerminalRequest): Promise<NativeTerminalDto>;
  stopNativeTerminal(taskId: string, agentId: string): Promise<void>;
  getNativeTerminalSnapshot(taskId: string, agentId: string): Promise<NativeTerminalSnapshotDto>;
  /** GET /v1/projects/:projectId/dev-session；没有会话时抛 not_found（404）。 */
  get(projectId: string): Promise<DevSessionDto>;
  /**
   * RFC-016 开发容器里的预览进程（**不是 preview 部署槽**）。
   * 读需要项目 view，控制需要 develop；容器未连接时抛 precondition，不返回 stopped。
   */
  previewStatus(projectId: string): Promise<PreviewStatusDto>;
  /** start／restart 只保证命令已受理，`ready` 要等健康探测，返回里通常仍是 `starting`。 */
  controlPreview(projectId: string, action: PreviewAction): Promise<PreviewStatusDto>;
  /** 预览进程自己的最近输出；跨重启保留，按 `attempt` 区分是哪一次运行。 */
  previewLogs(projectId: string, query?: Partial<PreviewLogsQuery>): Promise<PreviewLogsDto>;
  /** 只读、无副作用的释放／发布前检查；无会话 404，断线或 Git 失败返回 unavailable。 */
  workspaceStatus(projectId: string): Promise<WorkspaceStatusDto>;
  versionComparison(projectId: string, target?: ComparisonTarget): Promise<VersionComparisonDto>;
  versionComparisonDetails(projectId: string, comparisonId: string, query: ComparisonDetailQuery): Promise<ComparisonDetails>;
  refreshComparisonHistory(projectId: string, target?: ComparisonTarget): Promise<VersionComparisonDto>;
  /** POST /v1/projects/:projectId/dev-session（201） */
  open(projectId: string, input: OpenDevSessionRequest): Promise<DevSessionDto>;
  /** DELETE /v1/projects/:projectId/dev-session?force=true */
  release(projectId: string, options?: ReleaseDevSessionOptions): Promise<ReleaseDevSessionResult>;
  /** GET /v1/projects/:projectId/branches：各分支 HEAD 与落后两槽的提交数。 */
  listBranches(projectId: string): Promise<ItemsPage<BranchDto>>;
  /** POST /v1/projects/:projectId/publish（202）：有未提交更改时 412 precondition，details.uncommitted 列出路径。 */
  publish(projectId: string, input: PublishDevSessionInput): Promise<ReleaseDto>;
  /** GET /v1/tasks/:taskId/agents */
  listAgents(taskId: string): Promise<ItemsPage<AgentInstanceDto>>;
  /** POST /v1/tasks/:taskId/agents（201）：启动一个流式交互 Agent。 */
  startAgent(taskId: string, input: StartDevAgentRequest): Promise<AgentInstanceDto>;
  /** POST /v1/tasks/:taskId/agents/:agentId/messages（204） */
  sendMessage(taskId: string, agentId: string, input: SendAgentMessageRequest): Promise<void>;
  /** POST /v1/tasks/:taskId/agents/:agentId/cancel（204） */
  cancelAgent(taskId: string, agentId: string): Promise<void>;
  /** POST /v1/tasks/:taskId/touch（204）：刷新活动时间，避免空闲提醒。 */
  touch(taskId: string): Promise<void>;
}

export function devSessionResource(transport: Transport): DevSessionResource {
  const project = (projectId: string) => `/v1/projects/${segment(projectId)}`;
  const preview = (projectId: string) => `${project(projectId)}/dev-session/preview`;
  const agents = (taskId: string) => `/v1/tasks/${segment(taskId)}/agents`;
  const terminals = (taskId: string) => `/v1/tasks/${segment(taskId)}/agent-terminals`;
  return {
    inspectRebuild: (projectId) => transport.request('GET', `${project(projectId)}/dev-session/rebuild`),
    rebuild: (projectId, input) => transport.request('POST', `${project(projectId)}/dev-session/rebuild`, { body: input }),
    invokeApi: (projectId, input) => transport.request('POST', `${project(projectId)}/dev-session/api-invocations`, { body: input, keepalive: false, redirect: 'error', signal: AbortSignal.timeout(API_INVOCATION_TIMEOUT_MS + 20_000) }),
    getAgentActivity: (taskId, query) => transport.request('GET', `/v1/tasks/${segment(taskId)}/agent-activity`, { query }),
    readAgentActivity: (taskId, input) => transport.request('POST', `/v1/tasks/${segment(taskId)}/agent-activity/read`, { body: input }),
    getWorkspaceLayout: (taskId, options) => transport.request('GET', `/v1/tasks/${segment(taskId)}/workspace-layout`, { signal: options?.signal }),
    saveWorkspaceLayout: (taskId, input, options) => transport.request('PUT', `/v1/tasks/${segment(taskId)}/workspace-layout`, { body: input, signal: options?.signal }),
    listNativeTerminals: (taskId) => transport.request('GET', terminals(taskId)),
    startNativeTerminal: (taskId, input) => transport.request('POST', terminals(taskId), { body: input }),
    stopNativeTerminal: (taskId, agentId) => transport.request('POST', `${terminals(taskId)}/${segment(agentId)}/stop`),
    getNativeTerminalSnapshot: (taskId, agentId) => transport.request('GET', `${terminals(taskId)}/${segment(agentId)}/snapshot`),
    get: (projectId) => transport.request<DevSessionDto>('GET', `${project(projectId)}/dev-session`),
    previewStatus: (projectId) => transport.request<PreviewStatusDto>('GET', `${preview(projectId)}`),
    controlPreview: (projectId, action) => transport.request<PreviewStatusDto>('POST', `${preview(projectId)}/${action}`),
    previewLogs: (projectId, query) => transport.request<PreviewLogsDto>('GET', `${preview(projectId)}/logs`, { query }),
    workspaceStatus: (projectId) => transport.request<WorkspaceStatusDto>('GET', `${project(projectId)}/dev-session/workspace-status`),
    versionComparison: (projectId, target) => transport.request<VersionComparisonDto>('GET', `${project(projectId)}/dev-session/version-comparison`, { query: { target } }),
    versionComparisonDetails: (projectId, comparisonId, query) => transport.request<ComparisonDetails>('GET', `${project(projectId)}/dev-session/version-comparisons/${segment(comparisonId)}`, { query }),
    refreshComparisonHistory: (projectId, target = 'prod') => transport.request<VersionComparisonDto>('POST', `${project(projectId)}/dev-session/version-comparison/refresh-history`, { body: { target } }),
    open: (projectId, input) => transport.request<DevSessionDto>('POST', `${project(projectId)}/dev-session`, { body: input }),
    release: (projectId, options) =>
      transport.request<ReleaseDevSessionResult>('DELETE', `${project(projectId)}/dev-session`, { query: { force: options?.force ? 'true' : undefined, expectedTaskId: options?.expectedTaskId } }),
    listBranches: (projectId) => transport.request<ItemsPage<BranchDto>>('GET', `${project(projectId)}/branches`),
    publish: (projectId, input) => transport.request<ReleaseDto>('POST', `${project(projectId)}/publish`, { body: input }),
    listAgents: (taskId) => transport.request<ItemsPage<AgentInstanceDto>>('GET', agents(taskId)),
    startAgent: (taskId, input) => transport.request<AgentInstanceDto>('POST', agents(taskId), { body: input }),
    sendMessage: (taskId, agentId, input) => transport.request<void>('POST', `${agents(taskId)}/${segment(agentId)}/messages`, { body: input }),
    cancelAgent: (taskId, agentId) => transport.request<void>('POST', `${agents(taskId)}/${segment(agentId)}/cancel`),
    touch: (taskId) => transport.request<void>('POST', `/v1/tasks/${segment(taskId)}/touch`),
  };
}
