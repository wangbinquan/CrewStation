import type { Actor, ApiOperationDto, DataResourceDto, ProjectId, QuotaDto, ServiceId, ServicePlanDto, SubscriptionDto } from '@crewstation/contracts';

/** 能力说明只读聚合的各来源；全部由已有模块的公开查询提供。 */
export interface CapabilitySources {
  resolveServiceOfProject(projectId: ProjectId): Promise<{ serviceId: ServiceId; slug: string; name: string; identity: string; namespace: string } | undefined>;
  authorize(actor: Actor, projectId: ProjectId, action: 'view'): Promise<unknown>;
  quota(actor: Actor, projectId: ProjectId): Promise<QuotaDto>;
  servicePlans(): Promise<ServicePlanDto[]>;
  configKeys(actor: Actor, projectId: ProjectId, env: 'development' | 'production'): Promise<string[]>;
  dataResources(actor: Actor, projectId: ProjectId): Promise<DataResourceDto[]>;
  operations(actor: Actor, serviceId: ServiceId): Promise<ApiOperationDto[]>;
  subscriptions(actor: Actor, projectId: ProjectId): Promise<SubscriptionDto[]>;
}

export interface CapabilitySettings {
  readonly userDomain: string;
  readonly serviceDomain: string;
  readonly mcp: Array<{ name: string; url: string }>;
  readonly defaultServicePlan: string;
}
