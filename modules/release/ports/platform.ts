import type { Actor, ComputeProfileSelector, ConfigEnv, ProjectId, ServiceId, ServicePlanDto, UserId } from '@crewstation/contracts';

/** `manage-slots`：下线待验证版本、推迟自动下线、重新部署历史版本（RFC-021，负责人与管理员）。 */
export interface ProjectAuthorizer {
  authorize(actor: Actor, projectId: ProjectId, action: 'publish' | 'switch-traffic' | 'view' | 'view-preview' | 'manage-slots'): Promise<unknown>;
}

/** 由 gateway 模块经装配提供：项目处于维护中且三个开关都拦，即破坏性迁移的维护窗口（RFC-021 M14、M17）。直接读库，不走缓存。 */
export interface MaintenanceWindow {
  open(serviceId: ServiceId): Promise<boolean>;
}

/** 由 project 模块提供：自动下线的提醒发给项目负责人。 */
export interface ProjectOwners {
  ownerOf(projectId: ProjectId): Promise<UserId | undefined>;
}

/** 提醒的送达通道；与开发会话空闲提醒同一种端口，渠道仍待 Q20（RFC-021 B9）。 */
export interface SlotNotifier {
  notify(projectId: ProjectId, users: UserId[], message: string): Promise<void>;
}

export interface ServiceResolver {
  resolveServiceById(serviceId: ServiceId): Promise<{ projectId: ProjectId; slug: string; name: string; namespace: string } | undefined>;
}

export interface PlanCatalog {
  /** 发布必须传 projectId 校验项目范围；已运行实例维护只读取原规格。 */
  getServicePlan(name: string, projectId?: ProjectId): Promise<ServicePlanDto | undefined>;
  /**
   * 算力档位（RFC-001、RFC-006）：发布时校验 Manifest 引用的档位存在且不是通用终端协议；`default` 解析到当前默认档位。
   * 不看测试状态：能不能用在起 Agent 时判定。
   */
  lookupComputeProfile(selector: ComputeProfileSelector, projectId: ProjectId): Promise<{ name: string; terminalOnly: boolean } | undefined>;
  listComputeProfiles(): Promise<string[]>;
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
  readonly buildTimeoutSeconds: number;
  readonly deployTimeoutSeconds: number;
}
