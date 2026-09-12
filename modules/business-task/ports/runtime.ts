import type { Actor, AgentDriver, ProjectId, RunnerCommand, RunnerEvent, ServiceId, TaskId, TraceId, VolumeMode } from '@crewstation/contracts';

export interface EnvironmentView {
  id: TaskId;
  projectId: ProjectId;
  state: 'creating' | 'running' | 'paused' | 'releasing' | 'released' | 'failed';
  connected: boolean;
  traceId: string;
  podName: string;
}

/** 由 task-runtime 提供。 */
export interface Environments {
  createEnvironment(input: { serviceId: ServiceId; kind: 'business'; volumeMode?: VolumeMode; profile?: string; traceId?: TraceId; labels?: Record<string, string> }): Promise<EnvironmentView>;
  releaseEnvironment(taskId: TaskId, reason: 'business' | 'failed'): Promise<EnvironmentView>;
  pauseEnvironment(taskId: TaskId): Promise<EnvironmentView>;
  resumeEnvironment(taskId: TaskId): Promise<EnvironmentView>;
  getEnvironment(taskId: TaskId): Promise<EnvironmentView | undefined>;
}

/** 由 session-client 提供。 */
export interface Runner {
  sendCommand(taskId: TaskId, command: RunnerCommand): Promise<unknown>;
  listEvents(taskId: TaskId, options?: { sinceSeq?: number; kinds?: RunnerEvent['kind'][]; agentId?: string; limit?: number }): Promise<Array<{ seq: number; at: string; event: RunnerEvent }>>;
}

/** 由 project 提供：服务身份解析与用户视图授权。 */
export interface ServiceDirectory {
  resolveServiceIdentity(identity: string): Promise<{ serviceId: ServiceId; projectId: ProjectId } | undefined>;
}

/**
 * 由 project 模块提供（RFC-001）：算力档位名 → 具体驱动与模型。
 * 业务子任务引用的是 Manifest 里登记的档位名，解析同样发生在平台侧。
 */
export interface ComputeCatalog {
  resolve(name: string): Promise<{ name: string; driver: AgentDriver; model: string } | undefined>;
  list(): Promise<Array<{ name: string }>>;
}

export interface ProjectAuthorizer {
  authorize(actor: Actor, projectId: ProjectId, action: 'view'): Promise<unknown>;
}

export interface BusinessTaskSettings {
  readonly mcp: Array<{ name: string; url: string }>;
  readonly outputLimitBytes: number;
}
