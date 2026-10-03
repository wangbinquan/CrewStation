import type { ProjectId } from '@crewstation/contracts';

export interface OriginalInfrastructureOrigin {
  readonly complete: true; readonly id: string; readonly scope: 'project' | 'platform'; readonly projectIds: readonly ProjectId[]; readonly revision: string;
}
type ProjectOrigin = OriginalInfrastructureOrigin & { readonly scope: 'project' };
type PlatformOrigin = OriginalInfrastructureOrigin & { readonly scope: 'platform'; readonly projectIds: readonly [] };
type Representation = 'current' | 'legacy';
type Reader = (key: string, representation?: Representation) => Promise<ProjectOrigin | undefined>;
type RuntimeKind = 'task' | 'rebuild' | 'parent-ending';
type ClusterKind = 'cluster-refresh' | 'cluster-operation' | 'cluster-metrics' | 'cluster-storage';
type OriginKind = 'project' | 'service' | 'release' | 'task' | 'subtask' | 'delivery' | 'profile-test' | 'resource-change' | 'deletion' | 'api-operation' | RuntimeKind | ClusterKind;

/** Structural ports allow wiring to inject the public owner APIs without application importing other modules. */
export interface InfrastructureSourceModules {
  project: { originalInfrastructureOwnership(kind: 'project' | 'service' | 'deletion', key: string, representation?: Representation): Promise<ProjectOrigin | undefined> };
  events: { originalDeliveryOwnership: Reader };
  release: { originalInfrastructureOwnership: Reader };
  resourceAccess: { originalInfrastructureOwnership: Reader };
  apiCatalog: { originalInfrastructureOwnership: Reader };
  agentRuntime: { originalInfrastructureOwnership(key: string, representation?: Representation): Promise<PlatformOrigin | undefined> };
  taskRuntime: { originalInfrastructureOwnership(kind: RuntimeKind, key: string, representation?: Representation): Promise<OriginalInfrastructureOrigin | undefined> };
  businessTask: { originalInfrastructureOwnership(kind: 'task' | 'subtask', key: string, representation?: Representation): Promise<ProjectOrigin | undefined> };
  clusterManagement: { originalInfrastructureOwnership(kind: ClusterKind, key: string, representation?: Representation): Promise<OriginalInfrastructureOrigin | undefined> };
  identities: { resolve(kind: 'project' | 'service', keys: readonly string[]): Promise<string | undefined> };
}
export interface InfrastructureOriginSources {
  resolve(document: { channel: 'queue' | 'event'; name: string; payload: unknown; legacyPayload: unknown; identityProvenance: unknown },
    reference: { kind: OriginKind; key: string }, representation: Representation): Promise<OriginalInfrastructureOrigin | undefined>;
}
