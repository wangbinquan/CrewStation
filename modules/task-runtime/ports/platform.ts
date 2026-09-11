import type { Actor, ProjectId, ServiceId, TaskId } from '@crewstation/contracts';

export interface ProjectAuthorizer {
  authorize(actor: Actor, projectId: ProjectId, action: 'view' | 'develop' | 'force-release-session'): Promise<unknown>;
}

export interface QuotaSource {
  quotaLimit(projectId: ProjectId): Promise<number | undefined>;
}

export interface ProfileCatalog {
  getTaskProfile(name: string): Promise<{ name: string; cpu: string; memory: string; storage: string } | undefined>;
}

export interface ServiceResolver {
  resolveServiceById(serviceId: ServiceId): Promise<{ projectId: ProjectId; slug: string; name: string; namespace: string } | undefined>;
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
}
