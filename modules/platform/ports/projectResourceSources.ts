import type { Actor, ApiRequestDto, ConfigItemDto, DataResourceDto, LegacyResourceRequest, ObjectSpaceDto, ProjectId, ProjectResourceEdge, ProjectResourceNode, ReleaseDto, ReleaseResourceUsage, RepositoryBindingDto, ResourceView, ResourceWorkloadPage, RuntimeImageVersionDto, ServiceId, SlotDto, SubscriptionDto, TaskDataBindingDto } from '@crewstation/contracts';
import type { ProjectDeletionInventory } from '@crewstation/contracts';

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

interface RetainedNativeDsn { readonly origin: { readonly hostname: string; readonly port: number; readonly database: string; readonly role: string } | null }
export interface NativeDeletionHistoryInputs {
  readonly data: { readonly nativePostgresHistory?: { read(id: ProjectId): Promise<{
    readonly projectId: ProjectId; readonly retainedRecordsComplete: true; readonly revision: string;
    readonly resources: readonly { readonly id: string; readonly kind: string; readonly objectName: string; readonly dsn: RetainedNativeDsn }[];
    readonly bindings: readonly { readonly id: string; readonly mode: string; readonly roleName: string | null; readonly legacyResourceId: string | null; readonly dsn: RetainedNativeDsn }[];
    readonly aliases: readonly { readonly id: string; readonly valid: boolean; readonly keys: readonly string[] }[];
    readonly gaps: readonly { readonly id: string; readonly code: string; readonly message: string }[];
  }> } };
  readonly resources: { readonly projectDeletion: { nativePostgresHistory(id: ProjectId): Promise<{
    readonly retainedRecordsComplete: true; readonly revision: string;
    readonly records: readonly { readonly id: string; readonly owner: { readonly ref: string }; readonly declared: readonly { readonly kind: 'PostgresDatabase' | 'PostgresRole'; readonly name: string }[]; readonly observed: readonly { readonly kind: 'PostgresDatabase' | 'PostgresRole'; readonly name: string; readonly uid?: string }[] }[];
    readonly gaps: readonly { readonly code: string; readonly message: string; readonly resourceId: string }[];
  }> } };
}
export interface NativeDeletionHistoryPort {
  read(id: ProjectId): Promise<{ readonly complete: boolean; readonly currentRecordsComplete?: boolean; readonly revision: string; readonly records: readonly { resourceId: string; aliases: readonly string[]; names: readonly { kind: 'database' | 'role'; name: string; oid?: string }[] }[]; readonly blockers: ProjectDeletionInventory['blockers']; readonly references: ProjectDeletionInventory['references'] }>;
}
