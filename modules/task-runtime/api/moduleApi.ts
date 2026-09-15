import type { Actor, ProjectId, ServiceId, TaskId, TaskKind, TraceId, UserId, VolumeMode } from '@crewstation/contracts';
import type { DevSessionRebuildDto, DevSessionRebuildInspection, RebuildDevSessionRequest } from '@crewstation/contracts';

export type EnvironmentState = 'creating' | 'running' | 'paused' | 'releasing' | 'released' | 'failed';
export type ReleaseReason = 'user' | 'owner-force' | 'business' | 'failed' | 'pod-lost';

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
  native?: { parentTaskId: TaskId; agentId: string; terminalId: string; runnerId: string; state: 'queued' | 'starting' | 'running' | 'cleaning' | 'finished'; profile: { name: string; cpu: string; memory: string; storage: string }; failureReason?: string };
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

export interface CreateNativeExecutionInput {
  id: TaskId;
  parentTaskId: TaskId;
  createdBy: UserId;
  agentId: string;
  terminalId: string;
  runnerId: string;
  fingerprint: string;
  profile?: string;
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
}
