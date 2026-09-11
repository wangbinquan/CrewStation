import type { Actor, ProjectId, ServiceId, TaskId, TaskKind, TraceId, UserId, VolumeMode } from '@crewstation/contracts';

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
  branch?: string;
  traceId: string;
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

/** task-runtime 对外能力：环境生命周期与配额；授权由 dev-session／business-task 在调用前完成，这里只做准入与集群操作。 */
export interface TaskRuntimeModuleApi {
  readonly name: 'task-runtime';
  createEnvironment(input: CreateEnvironmentInput): Promise<EnvironmentDto>;
  releaseEnvironment(taskId: TaskId, reason: ReleaseReason): Promise<EnvironmentDto>;
  pauseEnvironment(taskId: TaskId): Promise<EnvironmentDto>;
  resumeEnvironment(taskId: TaskId): Promise<EnvironmentDto>;
  markFailed(taskId: TaskId, message: string): Promise<void>;
  touch(taskId: TaskId): Promise<void>;
  onRunnerConnected(taskId: TaskId): Promise<void>;
  onRunnerDisconnected(taskId: TaskId): Promise<void>;
  getEnvironment(taskId: TaskId): Promise<EnvironmentDto | undefined>;
  describeEnvironment(actor: Actor, taskId: TaskId): Promise<EnvironmentDto>;
  listEnvironments(actor: Actor, projectId: ProjectId, states?: EnvironmentState[]): Promise<EnvironmentDto[]>;
  findDevSession(projectId: ProjectId): Promise<EnvironmentDto | undefined>;
  verifyRunnerToken(taskId: TaskId, token: string): Promise<{ ok: true; projectId: string } | { ok: false; reason: string }>;
  canOpenStream(actor: Actor, taskId: TaskId): Promise<boolean>;
  reconcile(): Promise<number>;
}
