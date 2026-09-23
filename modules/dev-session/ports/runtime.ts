import type { Actor, ProjectId, RunnerCommand, RunnerEvent, ServiceId, StartupRecord, TaskId, TraceId, UserId } from '@crewstation/contracts';
import type { DevSessionDto, DevSessionRebuildDto, DevSessionRebuildInspection, RebuildDevSessionRequest } from '@crewstation/contracts';

export interface EnvironmentView {
  id: TaskId;
  projectId: ProjectId;
  serviceId: string;
  state: 'creating' | 'running' | 'paused' | 'releasing' | 'released' | 'failed';
  podName: string;
  connected: boolean;
  native?: { purpose: 'cli' | 'agent' | 'subtask'; parentTaskId: TaskId; agentId: string; terminalId?: string; runnerId: string; state: 'queued' | 'starting' | 'running' | 'cleaning' | 'finished'; profile: { name: string; cpu: string; memory: string; storage: string }; failureReason?: string };
  branch?: string;
  traceId: string;
  message?: string;
  connectionIssue?: DevSessionDto['connectionIssue'];
  /** RFC-022：task-runtime 产出的最近一次启动进度（存储形状）；升级前创建的环境没有。 */
  startup?: StartupRecord;
  createdAt: string;
  lastActivityAt: string;
}

/** 一个 Agent 的独立执行环境（RFC-006 §5）：「＋ CLI」带 terminalId，headless Agent 没有；image 是档位修订按摘要固定的镜像。 */
export interface CreateExecutionInput {
  id: TaskId; parentTaskId: TaskId; purpose: 'cli' | 'agent'; createdBy: UserId; agentId: string; terminalId?: string; runnerId: string; fingerprint: string;
  profile?: string; image?: string; computeProfile?: { profileId: string; revision: number };
}

/** 由 task-runtime 提供。 */
export interface Environments {
  createNativeExecution(input: CreateExecutionInput): Promise<EnvironmentView>;
  /** RFC-022：CLI 在准备环境或 Agent 启动中失败时，回收之前留下执行环境主容器日志的尾部（已打码）；读不到返回 undefined。 */
  captureStartupLog(taskId: TaskId): Promise<string | undefined>;
  inspectRebuild(projectId: ProjectId): Promise<DevSessionRebuildInspection>;
  requestRebuild(projectId: ProjectId, input: RebuildDevSessionRequest): Promise<DevSessionRebuildDto>;
  getRebuild(taskId: TaskId): Promise<DevSessionRebuildDto | undefined>;
  createEnvironment(input: { serviceId: ServiceId; kind: 'dev-session'; branch: string; createdBy: UserId; traceId?: TraceId; preview?: { command: string[]; port: number; healthPath: string }; labels?: Record<string, string> }): Promise<EnvironmentView>;
  releaseEnvironment(taskId: TaskId, reason: 'user' | 'owner-force'): Promise<EnvironmentView>;
  getEnvironment(taskId: TaskId): Promise<EnvironmentView | undefined>;
  findDevSession(projectId: ProjectId, options?: { includeLatestFailure?: boolean }): Promise<EnvironmentView | undefined>;
  listRunningDevSessions(): Promise<EnvironmentView[]>;
  touch(taskId: TaskId): Promise<void>;
  canOpenStream(actor: Actor, taskId: TaskId): Promise<boolean>;
}

/** 由 session-client 提供：向容器内 TaskRunner 下发命令、读取持久事件。 */
export interface Runner {
  sendCommand(taskId: TaskId, command: RunnerCommand): Promise<unknown>;
  listEvents(taskId: TaskId, options?: { sinceSeq?: number; kinds?: RunnerEvent['kind'][]; agentId?: string; limit?: number }): Promise<Array<{ seq: number; at: string; event: RunnerEvent }>>;
}

export interface ReminderRepository {
  lastReminder(taskId: TaskId): Promise<Date | undefined>;
  recordReminder(taskId: TaskId, at: Date): Promise<void>;
}
