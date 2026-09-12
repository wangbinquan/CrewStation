import type { Actor, ConfigEnv, ProjectId, ServiceId, ServicePlanDto } from '@crewstation/contracts';

export interface ProjectAuthorizer {
  authorize(actor: Actor, projectId: ProjectId, action: 'publish' | 'switch-traffic' | 'view'): Promise<unknown>;
}

export interface ServiceResolver {
  resolveServiceById(serviceId: ServiceId): Promise<{ projectId: ProjectId; slug: string; name: string; namespace: string } | undefined>;
}

export interface PlanCatalog {
  getServicePlan(name: string): Promise<ServicePlanDto | undefined>;
  /** 算力档位（RFC-001）：发布时校验 Manifest 引用的档位存在，不存在就不进构建。 */
  getComputeProfile(name: string): Promise<{ name: string } | undefined>;
  listComputeProfiles(): Promise<Array<{ name: string }>>;
}

/** 由 config 模块提供：生产组配置渲染为环境变量，并校验 Manifest env 段声明的键存在。 */
export interface ConfigSource {
  render(projectId: ProjectId, env: ConfigEnv): Promise<{ values: Record<string, string>; version: number }>;
  validate(projectId: ProjectId, env: ConfigEnv, keys: string[]): Promise<{ missing: string[] }>;
}

/** 由 data 模块提供：生产数据资源的连接环境变量。 */
export interface DataSource {
  envFor(serviceId: ServiceId, env: ConfigEnv): Promise<Record<string, string>>;
}

export interface HostNaming {
  prodHost(projectSlug: string): string;
  previewHost(projectSlug: string): string;
}

export interface ReleaseSettings {
  readonly userDomain: string;
  readonly serviceDomain: string;
  readonly registryBase: string;
  readonly maintenanceWindow: boolean;
  readonly buildTimeoutSeconds: number;
  readonly deployTimeoutSeconds: number;
}
