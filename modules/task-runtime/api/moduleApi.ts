import type { Actor, ProjectId, ServiceId, TaskId, TaskKind, TraceId, UserId, VolumeMode } from '@crewstation/contracts';
import type { DevSessionDto, DevSessionRebuildDto, DevSessionRebuildInspection, RebuildDevSessionRequest, StartupRecord } from '@crewstation/contracts';
import type { BeforeStartMaterial, LaunchSpec, ProfileTestContext, ProfileTestOutcome, ProfileTestStage, TerminalTest } from '@crewstation/contracts';

/**
 * 档位测试（RFC-006 §6）：输入为一个档位修订的镜像、launch 与启动前材料，加上已知协议的 nonce 提示或通用终端的测试命令；
 * 进度按阶段上报，结局三态，unknown 表示环境中途丢失、无法确认启动前脚本是否已执行。
 */
export interface ProfileTestRunInput {
  testId: string; profile: string; revision: number; launch: LaunchSpec; image: string; taskProfile?: string;
  beforeStart: BeforeStartMaterial; prompt: string; expectedReply: string; terminalTest?: TerminalTest;
}
export interface ProfileTestRunProgress { context?: Partial<ProfileTestContext>; stages?: ProfileTestStage[] }
export interface ProfileTestRunResult { state: 'passed' | 'failed' | 'unknown'; outcome?: ProfileTestOutcome; error?: string; context?: Partial<ProfileTestContext>; stages: ProfileTestStage[] }

export type EnvironmentState = 'creating' | 'running' | 'paused' | 'releasing' | 'released' | 'failed';
export type ReleaseReason = 'user' | 'owner-force' | 'business' | 'failed' | 'pod-lost' | 'profile-test';

export interface EnvironmentDto {
  id: TaskId;
  projectId: ProjectId;
  serviceId: string;
  kind: TaskKind;
  state: EnvironmentState;
  volumeMode: VolumeMode;
  profile: string;
  podName: string;
  connected: boolean;
  native?: { purpose: 'cli' | 'agent' | 'subtask'; parentTaskId: TaskId; agentId: string; terminalId?: string; runnerId: string; state: 'queued' | 'starting' | 'running' | 'cleaning' | 'finished'; profile: { name: string; cpu: string; memory: string; storage: string }; failureReason?: string };
  branch?: string;
  preview?: { command: string[]; port: number; healthPath: string };
  traceId: string;
  createdBy?: string;
  message?: string;
  connectionIssue?: DevSessionDto['connectionIssue'];
  /** RFC-022：最近一次启动的阶段进度（存储形状；observedAt 由组装 HTTP 响应的一方填）。 */
  startup?: StartupRecord;
  createdAt: string;
  lastActivityAt: string;
}

/** 调用链的时间键：firstAt 为毫秒精度的开始时间；before 取上一页最后一条的 (firstAt, traceId)。 */
export interface TraceKeyDto { traceId: string; firstAt: string; lastAt: string; active: boolean }
export interface TraceKeyPage { before?: { at: string; traceId: string }; limit: number }
/** 调用链回放用的环境：比 EnvironmentDto 多最后一次状态变化的时间，已释放或失败时即结束时间。 */
export type TraceEnvironmentDto = EnvironmentDto & { updatedAt: string };

export interface CreateEnvironmentInput {
  serviceId: ServiceId;
  kind: TaskKind;
  volumeMode?: VolumeMode;
  profile?: string;
  branch?: string;
  traceId?: TraceId;
  createdBy?: UserId;
  preview?: { command: string[]; port: number; healthPath: string };
  labels?: Record<string, string>;
}

/**
 * 为一个 Agent 登记独立执行环境（RFC-006 §5）：cli／agent 的父任务是开发会话，subtask 的父任务是业务任务。
 * image 是档位修订按摘要固定的镜像；省略时用平台任务镜像（RFC-006 之前受理的 CLI）。
 */
export interface CreateNativeExecutionInput {
  id: TaskId;
  parentTaskId: TaskId;
  purpose?: 'cli' | 'agent' | 'subtask';
  /** 业务子任务没有发起用户。 */
  createdBy?: UserId;
  agentId: string;
  terminalId?: string;
  runnerId: string;
  fingerprint: string;
  profile?: string;
  image?: string;
  computeProfile?: { profileId: string; revision: number };
}

/** task-runtime 对外能力：环境生命周期与配额；授权由 dev-session／business-task 在调用前完成，这里只做准入与集群操作。 */
export interface TaskRuntimeModuleApi {
  readonly name: 'task-runtime';
  listClusterTasks(): Promise<Array<{ taskId: string; projectId: string; namespace: string; podName: string; podUid?: string; pvcName: string; pvcUid?: string; kind: string; state: string; purpose?: string; parentTaskId?: string; agentId?: string; terminalId?: string; profile: string; profileRevision?: number; profileTestId?: string; revision: string; volumeMode: string }>>;
  createEnvironment(input: CreateEnvironmentInput): Promise<EnvironmentDto>;
  createNativeExecution(input: CreateNativeExecutionInput): Promise<EnvironmentDto>;
  releaseEnvironment(taskId: TaskId, reason: ReleaseReason): Promise<EnvironmentDto>;
  pauseEnvironment(taskId: TaskId): Promise<EnvironmentDto>;
  resumeEnvironment(taskId: TaskId): Promise<EnvironmentDto>;
  markFailed(taskId: TaskId, message: string): Promise<void>;
  touch(taskId: TaskId): Promise<void>;
  onRunnerConnected(taskId: TaskId, token: string): Promise<boolean>;
  onRunnerDisconnected(taskId: TaskId, token: string): Promise<void>;
  /** 握手被拒（协议不一致）：只记录原因，不改状态、不删 Pod（RFC-006 §5.3）。 */
  onRunnerRejected(taskId: TaskId, token: string, rejection: { code: 'protocol_mismatch'; runnerProtocol: number | null; message: string }): Promise<void>;
  inspectRebuild(projectId: ProjectId, administrator?: boolean): Promise<DevSessionRebuildInspection>;
  requestRebuild(projectId: ProjectId, input: RebuildDevSessionRequest): Promise<DevSessionRebuildDto>;
  getRebuild(taskId: TaskId): Promise<DevSessionRebuildDto | undefined>;
  getEnvironment(taskId: TaskId): Promise<EnvironmentDto | undefined>;
  describeEnvironment(actor: Actor, taskId: TaskId): Promise<EnvironmentDto>;
  listEnvironments(actor: Actor, projectId: ProjectId, states?: EnvironmentState[]): Promise<EnvironmentDto[]>;
  /** 只读展示可含最近一次失败；创建／释放等既有操作仍只查当前活跃会话。 */
  findDevSession(projectId: ProjectId, options?: { includeLatestFailure?: boolean }): Promise<EnvironmentDto | undefined>;
  listRunningDevSessions(): Promise<EnvironmentDto[]>;
  /** 已占用的并发任务数（准入计数器的当前值）；配额展示读它。 */
  runningTaskCount(projectId: ProjectId): Promise<number>;
  /** 调用链列表（Design §14）：本项目开发会话与业务任务按 traceId 分组的时间键，按开始时间倒序翻页。 */
  traceKeys(projectId: ProjectId, page: TraceKeyPage): Promise<TraceKeyDto[]>;
  /** since（ISO 时间）之后有活动、或仍在进行的链。 */
  activeTraceIds(projectId: ProjectId, since: string): Promise<string[]>;
  /** 这些链在本项目里的全部环境（含各个 Agent 执行），按创建时间正序；不跨项目。 */
  listTraceEnvironments(projectId: ProjectId, traceIds: readonly string[]): Promise<TraceEnvironmentDto[]>;
  verifyRunnerToken(taskId: TaskId, token: string): Promise<{ ok: true; projectId: string } | { ok: false; reason: string }>;
  canOpenStream(actor: Actor, taskId: TaskId): Promise<boolean>;
  reconcile(): Promise<number>;
  /** RFC-022：每秒看一页启动中的环境，推进阶段细节并按对账规则判定失败；返回写入次数。 */
  observeStartup(): Promise<number>;
  /**
   * RFC-022：执行环境主容器日志的最后 100 行（已打码）。CLI 在准备环境或 Agent 启动中失败时，
   * dev-session 在请求回收之前调用它，给失败的那一段留证；读不到返回 undefined。
   */
  captureStartupLog(taskId: TaskId): Promise<string | undefined>;
  /**
   * RFC-025 I25：资源中心建工作区的 Runner Secret 之前要它的内容（配置、数据连接串与新签发的 Runner 令牌，令牌只存哈希）；
   * 环境眼下不需要建出容器时拒绝。值只交给调和器，不落库。
   */
  runnerValues(taskId: TaskId): Promise<Record<string, string>>;
  /** RFC-025 I25：资源中心建出 Pod 后记下实例（执行环境另记 Runner Secret 的实例）；环境已不需要建出时忽略。 */
  bindWorkload(taskId: TaskId, podUid: string, secretUid?: string): Promise<void>;
  /** RFC-025 I25 第二步：执行环境的父工作区在建出之前换了实例，判这个执行环境失败；已不在排队时忽略。 */
  workloadUnavailable(taskId: TaskId, code: 'workspace-changed'): Promise<void>;
  /** RFC-004：在平台专属检查任务里执行完整 Hook 与一次最小模型调用，结束后清理任务；供 agent-runtime 的执行器端口。 */
  runProfileTest(input: ProfileTestRunInput, report: (progress: ProfileTestRunProgress) => Promise<void>, heartbeat: () => Promise<boolean>): Promise<ProfileTestRunResult>;
}
