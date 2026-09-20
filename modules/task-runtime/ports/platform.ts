import type { Actor, ProjectId, RunnerCommand, RunnerEvent, RunnerHello, ServiceId, TaskId, TaskProfileDto } from '@crewstation/contracts';

export interface ProjectAuthorizer {
  authorize(actor: Actor, projectId: ProjectId, action: 'view' | 'develop' | 'force-release-session'): Promise<unknown>;
}

export interface QuotaSource {
  quotaLimit(projectId: ProjectId): Promise<number | undefined>;
}

export interface ProfileCatalog {
  /** 分配过开发套餐的项目只能用该套餐；未分配保持原默认／恢复行为。 */
  devSessionProfile?(projectId: ProjectId): Promise<string | undefined>;
  listTaskProfiles(): Promise<TaskProfileDto[]>;
  getTaskProfile(id: string): Promise<{ id: string; name: string; cpu: string; memory: string; storage: string } | undefined>;
}

export interface ServiceResolver {
  resolveServiceById(serviceId: ServiceId): Promise<{ projectId: ProjectId; slug: string; name: string; namespace: string } | undefined>;
}

/**
 * 由 scm 模块提供：开发会话要把仓库克隆进工作卷，否则开发容器里是空目录。
 * 只签只读凭据——推送由平台在发布时完成，容器内不需要写权限。
 */
export interface SourceCheckoutSource {
  checkoutFor(serviceId: ServiceId, branch: string): Promise<{ repoUrl: string; credentialSecretName: string } | undefined>;
}

/** 由 config 与 data 模块提供：开发组配置与开发库／任务级数据访问的环境变量。 */
export interface EnvironmentSources {
  configEnv(projectId: ProjectId, env: 'development' | 'production'): Promise<Record<string, string>>;
  dataEnv(serviceId: ServiceId, env: 'development' | 'production'): Promise<Record<string, string>>;
  taskDataEnv(taskId: TaskId): Promise<Record<string, string>>;
}

export interface TaskRuntimeSettings {
  readonly taskImage: string;
  readonly systemNamespace: string;
  readonly sessionUrl: string;
  readonly userDomain: string;
  readonly serviceDomain: string;
  readonly workerUid: number;
  readonly defaultProfile: string;
  /** 开发预览是用户域主机，路由要挂网关的这两个系统中间件。 */
  readonly userAuthMiddleware: string;
  readonly dropIdentityHeadersMiddleware: string;
}

/**
 * 由 session-client 提供（RFC-006 档位测试）：向测试任务的 TaskRunner 下发命令、读持久事件、读握手能力。
 * task-runtime 平时不需要它；只有档位测试在这里等待启动前步骤与协议轮次的结果。
 */
export interface TestRunner {
  sendCommand(taskId: TaskId, command: RunnerCommand): Promise<unknown>;
  listEvents(taskId: TaskId, options?: { sinceSeq?: number; kinds?: RunnerEvent['kind'][]; agentId?: string; limit?: number }): Promise<Array<{ seq: number; at: string; event: RunnerEvent }>>;
  connectionStatus(taskId: TaskId): Promise<{ connected: boolean; capabilities?: RunnerHello['capabilities'] }>;
}
