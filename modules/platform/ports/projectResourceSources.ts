import type { Actor, ApiRequestDto, ConfigItemDto, DataResourceDto, LegacyResourceRequest, ObjectSpaceDto, ProjectId, ProjectResourceEdge, ProjectResourceNode, ReleaseDto, ReleaseResourceUsage, RepositoryBindingDto, ResourceView, ResourceWorkloadPage, RuntimeImageVersionDto, ServiceId, SlotDto, SubscriptionDto, TaskDataBindingDto } from '@crewstation/contracts';

export interface ProjectResourceFragment { nodes: ProjectResourceNode[]; edges: ProjectResourceEdge[]; complete?: boolean; message?: string }
export interface ProjectResourceSource { id: string; name: string; load(actor: Actor, projectId: ProjectId): Promise<ProjectResourceFragment> }
export interface ProjectResourceDetailPorts {
  actor: Actor; service(id: ProjectId): Promise<{ serviceId: ServiceId; name: string; namespace: string; identity: string } | undefined>;
  ledger(actor: Actor, id: ProjectId): Promise<ResourceView>;
  repository(actor: Actor, id: ServiceId): Promise<RepositoryBindingDto>;
  releases(actor: Actor, id: ServiceId): Promise<ReleaseDto[]>; slots(actor: Actor, id: ServiceId): Promise<SlotDto[]>; releaseUsage(actor: Actor, id: ServiceId): Promise<ReleaseResourceUsage[]>;
  workloads(actor: Actor, id: ProjectId, page: { after?: string; limit: number }): Promise<ResourceWorkloadPage>;
  config(actor: Actor, id: ProjectId, env: 'development' | 'production'): Promise<ConfigItemDto[]>;
  data(actor: Actor, id: ProjectId): Promise<DataResourceDto[]>; spaces?(actor: Actor, id: ProjectId): Promise<ObjectSpaceDto[]>; bindings(actor: Actor, id: ProjectId): Promise<TaskDataBindingDto[]>;
  apiRequests(actor: Actor, id: ProjectId): Promise<ApiRequestDto[]>; subscriptions(actor: Actor, id: ProjectId): Promise<SubscriptionDto[]>;
  imageVersion(actor: Actor, id: string, versionId: string): Promise<RuntimeImageVersionDto>;
  quota(id: ProjectId): Promise<{ spec?: { hard?: Record<string, string> }; status?: { hard?: Record<string, string>; used?: Record<string, string> } } | undefined>;
  mcp: Array<{ name: string; url: string }>;
}
export type LegacyRequestReader = (actor: Actor, id: ProjectId) => Promise<LegacyResourceRequest[]>;
