import type { Actor, AgentProtocol, BeforeStartMaterial, ComputeProfileSelector, ComputeUsage, LaunchSpec, ProfileRevisionRef, ProjectId, RunnerCommand, RunnerEvent, ServiceId, TaskId, TraceId, VolumeMode } from '@crewstation/contracts';

export interface EnvironmentView {
  id: TaskId;
  projectId: ProjectId;
  state: 'creating' | 'running' | 'paused' | 'releasing' | 'released' | 'failed';
  connected: boolean;
  traceId: string;
  podName: string;
  profile: string;
  message?: string;
  /** 子任务的独立执行环境（RFC-006 §5.4）；业务任务容器本身没有。 */
  native?: { state: 'queued' | 'starting' | 'running' | 'cleaning' | 'finished'; failureReason?: string };
}

/** Agent 子任务的独立执行环境（每个 Agent 一个 Pod，占一个项目并发额度）；image 是档位修订按摘要固定的镜像。 */
export interface CreateSubtaskExecutionInput {
  id: TaskId; parentTaskId: TaskId; purpose: 'subtask'; agentId: string; runnerId: string; fingerprint: string;
  profile?: string; image?: string; computeProfile?: { profileId: string; revision: number };
}

/** 由 task-runtime 提供。 */
export interface Environments {
  createEnvironment(input: { serviceId: ServiceId; kind: 'business'; volumeMode?: VolumeMode; profile?: string; traceId?: TraceId; labels?: Record<string, string> }): Promise<EnvironmentView>;
  createNativeExecution(input: CreateSubtaskExecutionInput): Promise<EnvironmentView>;
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

/** 受理时解析出的档位（RFC-006）：`default` 已换成真实名称，修订固定。 */
export interface ResolvedCompute {
  id: string;
  name: string;
  revision: number;
  protocol: AgentProtocol;
  taskProfile?: string;
  /** 按摘要固定的镜像引用。 */
  image: string;
}

/** 派发一次启动的材料（含解密凭据）：只在下发命令时取，不落库、不进日志、不进事件。 */
export interface ComputeLaunch extends ResolvedCompute {
  launch: LaunchSpec;
  beforeStart: BeforeStartMaterial;
}

/**
 * 由 agent-runtime 提供（RFC-006）：业务子任务引用 Manifest 登记的档位名或 `default`，解析发生在平台侧。
 * 不存在报 validation（details.available 列出可选）；没有默认档位、档位不可用报 precondition；终端档位报 validation。
 */
export interface ComputeCatalog {
  resolve(selector: ComputeProfileSelector | undefined, usage: ComputeUsage, projectId: ProjectId): Promise<ResolvedCompute>;
  /** 按受理时固定的修订取材料：停用或改了当前修订都不影响它。 */
  launchMaterial(ref: ProfileRevisionRef): Promise<ComputeLaunch>;
}

export interface ProjectAuthorizer {
  authorize(actor: Actor, projectId: ProjectId, action: 'view'): Promise<unknown>;
}

export interface BusinessTaskSettings {
  readonly mcp: Array<{ name: string; url: string }>;
  readonly outputLimitBytes: number;
}
