import type { Actor, ProjectId, ServiceId, TaskId, TaskKind, TraceId, UserId, VolumeMode } from '@crewstation/contracts';
import type { DevSessionRebuildDto, DevSessionRebuildInspection, RebuildDevSessionRequest } from '@crewstation/contracts';
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
  createdAt: string;
  lastActivityAt: string;
}

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
  computeProfile?: { name: string; revision: number };
}

/** task-runtime 对外能力：环境生命周期与配额；授权由 dev-session／business-task 在调用前完成，这里只做准入与集群操作。 */
export interface TaskRuntimeModuleApi {
  readonly name: 'task-runtime';
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
  inspectRebuild(projectId: ProjectId): Promise<DevSessionRebuildInspection>;
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
  listByTrace(traceId: string): Promise<EnvironmentDto[]>;
  verifyRunnerToken(taskId: TaskId, token: string): Promise<{ ok: true; projectId: string } | { ok: false; reason: string }>;
  canOpenStream(actor: Actor, taskId: TaskId): Promise<boolean>;
  reconcile(): Promise<number>;
  /** RFC-004：在平台专属检查任务里执行完整 Hook 与一次最小模型调用，结束后清理任务；供 agent-runtime 的执行器端口。 */
  runProfileTest(input: ProfileTestRunInput, report: (progress: ProfileTestRunProgress) => Promise<void>, heartbeat: () => Promise<boolean>): Promise<ProfileTestRunResult>;
}
