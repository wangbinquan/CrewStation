import type { Actor, ProjectId, ServiceId, TaskId, TaskProfileDto } from '@crewstation/contracts';

export interface ProjectAuthorizer {
  authorize(actor: Actor, projectId: ProjectId, action: 'view' | 'develop' | 'force-release-session'): Promise<unknown>;
}

export interface QuotaSource {
  quotaLimit(projectId: ProjectId): Promise<number | undefined>;
}

export interface ProfileCatalog {
  listTaskProfiles(): Promise<TaskProfileDto[]>;
  getTaskProfile(name: string): Promise<{ name: string; cpu: string; memory: string; storage: string } | undefined>;
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
  readonly agentEnvSecretName?: string;
  readonly defaultProfile: string;
  /** 开发预览是用户域主机，路由要挂网关的这两个系统中间件。 */
  readonly userAuthMiddleware: string;
  readonly dropIdentityHeadersMiddleware: string;
}
