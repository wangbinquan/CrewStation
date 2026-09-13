import type { AgentInstanceDto, BranchDto, DevSessionDto, OpenDevSessionRequest, ReleaseDto, SendAgentMessageRequest, WorkspaceStatusDto } from '@crewstation/contracts';
import type { ComparisonDetailQuery, ComparisonDetails, ComparisonTarget, VersionComparisonDto } from '@crewstation/contracts';
import type { NativeTerminalDto, NativeTerminalList, StartNativeTerminalRequest } from '@crewstation/contracts';
import type { SaveWorkspaceLayoutRequest, WorkspaceLayoutDto } from '@crewstation/contracts';
import type { AgentActivityPage, AgentActivityQuery, ReadAgentActivityRequest } from '@crewstation/contracts';
import type { Transport } from '../httpTransport';
import type { ItemsPage } from '../itemsPage';
import type { PublishInput, StartDevAgentInput } from '../requestInputs';
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
  getAgentActivity(taskId: string, query?: AgentActivityQuery): Promise<AgentActivityPage>;
  readAgentActivity(taskId: string, input: ReadAgentActivityRequest): Promise<{ throughSeq: number }>;
  getWorkspaceLayout(taskId: string): Promise<WorkspaceLayoutDto>;
  saveWorkspaceLayout(taskId: string, input: SaveWorkspaceLayoutRequest): Promise<WorkspaceLayoutDto>;
  listNativeTerminals(taskId: string): Promise<NativeTerminalList>;
  startNativeTerminal(taskId: string, input: StartNativeTerminalRequest): Promise<NativeTerminalDto>;
  stopNativeTerminal(taskId: string, agentId: string): Promise<void>;
  /** GET /v1/projects/:projectId/dev-session；没有会话时抛 not_found（404）。 */
  get(projectId: string): Promise<DevSessionDto>;
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
  publish(projectId: string, input: PublishInput): Promise<ReleaseDto>;
  /** GET /v1/tasks/:taskId/agents */
  listAgents(taskId: string): Promise<ItemsPage<AgentInstanceDto>>;
  /** POST /v1/tasks/:taskId/agents（201）：启动一个流式交互 Agent。 */
  startAgent(taskId: string, input: StartDevAgentInput): Promise<AgentInstanceDto>;
  /** POST /v1/tasks/:taskId/agents/:agentId/messages（204） */
  sendMessage(taskId: string, agentId: string, input: SendAgentMessageRequest): Promise<void>;
  /** POST /v1/tasks/:taskId/agents/:agentId/cancel（204） */
  cancelAgent(taskId: string, agentId: string): Promise<void>;
  /** POST /v1/tasks/:taskId/touch（204）：刷新活动时间，避免空闲提醒。 */
  touch(taskId: string): Promise<void>;
}

export function devSessionResource(transport: Transport): DevSessionResource {
  const project = (projectId: string) => `/v1/projects/${segment(projectId)}`;
  const agents = (taskId: string) => `/v1/tasks/${segment(taskId)}/agents`;
  const terminals = (taskId: string) => `/v1/tasks/${segment(taskId)}/agent-terminals`;
  return {
    getAgentActivity: (taskId, query) => transport.request('GET', `/v1/tasks/${segment(taskId)}/agent-activity`, { query }),
    readAgentActivity: (taskId, input) => transport.request('POST', `/v1/tasks/${segment(taskId)}/agent-activity/read`, { body: input }),
    getWorkspaceLayout: (taskId) => transport.request('GET', `/v1/tasks/${segment(taskId)}/workspace-layout`),
    saveWorkspaceLayout: (taskId, input) => transport.request('PUT', `/v1/tasks/${segment(taskId)}/workspace-layout`, { body: input }),
    listNativeTerminals: (taskId) => transport.request('GET', terminals(taskId)),
    startNativeTerminal: (taskId, input) => transport.request('POST', terminals(taskId), { body: input }),
    stopNativeTerminal: (taskId, agentId) => transport.request('POST', `${terminals(taskId)}/${segment(agentId)}/stop`),
    get: (projectId) => transport.request<DevSessionDto>('GET', `${project(projectId)}/dev-session`),
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
