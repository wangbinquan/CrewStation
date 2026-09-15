import type { Actor, ProjectId, RunnerCommand, RunnerEvent, ServiceId, TaskId, TraceId, UserId } from '@crewstation/contracts';
import type { DevSessionRebuildDto, DevSessionRebuildInspection, RebuildDevSessionRequest } from '@crewstation/contracts';

export interface EnvironmentView {
  id: TaskId;
  projectId: ProjectId;
  serviceId: string;
  state: 'creating' | 'running' | 'paused' | 'releasing' | 'released' | 'failed';
  podName: string;
  connected: boolean;
  branch?: string;
  traceId: string;
  message?: string;
  createdAt: string;
  lastActivityAt: string;
}

/** 由 task-runtime 提供。 */
export interface Environments {
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
