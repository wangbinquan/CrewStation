import type { Actor, AgentInstanceDto, BranchDto, DevSessionDto, OpenDevSessionRequest, ProjectId, PublishDevSessionRequest, ReleaseDto, SendAgentMessageRequest, StartDevAgentRequest, TaskId, WorkspaceStatusDto } from '@crewstation/contracts';
import type { ComparisonDetailQuery, ComparisonDetails, ComparisonTarget, VersionComparisonDto } from '@crewstation/contracts';
import type { NativeTerminalDto, NativeTerminalList, NativeTerminalSnapshotDto, StartNativeTerminalRequest } from '@crewstation/contracts';
import type { SaveWorkspaceLayoutRequest, WorkspaceLayoutDto } from '@crewstation/contracts';
import type { AgentActivityPage, AgentActivityQuery, ReadAgentActivityRequest } from '@crewstation/contracts';
import type { ApiInvocationRequest, ApiInvocationResponse } from '@crewstation/contracts';
import type { DevSessionRebuildDto, DevSessionRebuildInspection, RebuildDevSessionRequest } from '@crewstation/contracts';
import type { PreviewAction, PreviewLogsDto, PreviewLogsQuery, PreviewStatusDto } from '@crewstation/contracts';

/** dev-session 对外能力：一项目一会话、分支、并行流式 Agent、从会话发布、空闲提醒。 */
export interface NativeTerminalApi {
  startNativeTerminal(actor: Actor, taskId: TaskId, input: StartNativeTerminalRequest): Promise<NativeTerminalDto>;
  listNativeTerminals(actor: Actor, taskId: TaskId): Promise<NativeTerminalList>;
  stopNativeTerminal(actor: Actor, taskId: TaskId, agentId: string): Promise<void>;
  getNativeTerminalSnapshot(actor: Actor, taskId: TaskId, agentId: string): Promise<NativeTerminalSnapshotDto>;
}

export interface DevSessionModuleApi extends NativeTerminalApi {
  readonly name: 'dev-session';
  inspectClusterNative(actor: Actor, id: TaskId): Promise<Record<string, unknown>>;
  inspectClusterAgent(actor: Actor, id: TaskId): Promise<Record<string, unknown>>;
  manageClusterNative(actor: Actor, id: TaskId, restart: boolean, operationId: string): Promise<{ operationId: string }>;
  manageClusterAgent(actor: Actor, id: TaskId, restart: boolean, operationId: string): Promise<{ operationId: string }>;
  dispatchPendingNativeExecution(executionTaskId: TaskId): Promise<void>;
  reconcileNativeExecutions(): Promise<void>;
  inspectSessionRebuild(actor: Actor, projectId: ProjectId): Promise<DevSessionRebuildInspection>;
  rebuildSession(actor: Actor, projectId: ProjectId, input: RebuildDevSessionRequest): Promise<DevSessionRebuildDto>;
  invokeApi(actor: Actor, projectId: ProjectId, input: ApiInvocationRequest): Promise<ApiInvocationResponse>;
  getAgentActivity(actor: Actor, taskId: TaskId, query: AgentActivityQuery): Promise<AgentActivityPage>;
  readAgentActivity(actor: Actor, taskId: TaskId, input: ReadAgentActivityRequest): Promise<{ throughSeq: number }>;
  getWorkspaceLayout(actor: Actor, taskId: TaskId): Promise<WorkspaceLayoutDto>;
  saveWorkspaceLayout(actor: Actor, taskId: TaskId, input: SaveWorkspaceLayoutRequest): Promise<WorkspaceLayoutDto>;
  /** RFC-016：开发容器里的预览进程；不是 preview 部署槽。读用 view，控制用 develop。 */
  previewStatus(actor: Actor, projectId: ProjectId): Promise<PreviewStatusDto>;
  controlPreview(actor: Actor, projectId: ProjectId, action: PreviewAction): Promise<PreviewStatusDto>;
  previewLogs(actor: Actor, projectId: ProjectId, query: PreviewLogsQuery): Promise<PreviewLogsDto>;
  openSession(actor: Actor, projectId: ProjectId, input: OpenDevSessionRequest): Promise<DevSessionDto>;
  getSession(actor: Actor, projectId: ProjectId): Promise<DevSessionDto | undefined>;
  listBranches(actor: Actor, projectId: ProjectId): Promise<BranchDto[]>;
  workspaceStatus(actor: Actor, projectId: ProjectId): Promise<WorkspaceStatusDto>;
  versionComparison(actor: Actor, projectId: ProjectId, target?: ComparisonTarget): Promise<VersionComparisonDto>;
  versionComparisonDetails(actor: Actor, projectId: ProjectId, comparisonId: string, query: ComparisonDetailQuery): Promise<ComparisonDetails>;
  refreshComparisonHistory(actor: Actor, projectId: ProjectId, target?: ComparisonTarget): Promise<VersionComparisonDto>;
  releaseSession(actor: Actor, projectId: ProjectId, options?: { force?: boolean; expectedTaskId?: TaskId }): Promise<{ session: DevSessionDto; unpushed: string[] | null; workspace: WorkspaceStatusDto }>;
  startAgent(actor: Actor, taskId: TaskId, input: StartDevAgentRequest): Promise<AgentInstanceDto>;
  sendMessage(actor: Actor, taskId: TaskId, agentId: string, input: SendAgentMessageRequest): Promise<void>;
  cancelAgent(actor: Actor, taskId: TaskId, agentId: string): Promise<void>;
  listAgents(actor: Actor, taskId: TaskId): Promise<AgentInstanceDto[]>;
  publish(actor: Actor, projectId: ProjectId, input: PublishDevSessionRequest): Promise<ReleaseDto>;
  touch(taskId: TaskId): Promise<void>;
  sendIdleReminders(): Promise<number>;
}
