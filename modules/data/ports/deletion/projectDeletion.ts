import type { ProjectDeletionContext, ProjectDeletionEvidence, ProjectDeletionInventory, ProjectDeletionOwner, ProjectDeletionPhase, ProjectDeletionStepResult, ProjectDeletionTarget, ProjectId } from '@crewstation/contracts';

export interface DataDeletionOrigin { readonly complete: true; readonly id: string; readonly projectId: ProjectId }
export interface DataDeletionSources {
  resolve(kind: 'project' | 'service' | 'task', key: string): Promise<DataDeletionOrigin | undefined>;
  reference?(type: string, id: string): Promise<DataDeletionOrigin | undefined>;
  assertGrant(context: ProjectDeletionContext): Promise<void>;
}
export interface DataDeletionContent { readonly table: string; readonly key: string; readonly digest: string }
export interface DataDeletionIdentity { readonly kind: string; readonly key: string; readonly id: string; readonly projectId: ProjectId }
export interface DataDeletionLocation { readonly backendId: string; readonly placementRevision: number; readonly key: string; readonly size: number }
export interface DataDeletionPlacement { readonly spaceId: string; readonly backendId: string; readonly placementRevision: number }
/** Native history survives logical object deletion and owner restarts. The
 * payload contains only origins, version IDs, block hashes and file epochs. */
export interface DataDeletionNativeHistory { readonly version: 1; readonly identity: string; readonly digest: string; readonly body: unknown }
export interface DataDeletionScope {
  readonly contents: readonly DataDeletionContent[];
  readonly origins: readonly DataDeletionIdentity[];
  readonly locations: readonly DataDeletionLocation[];
  readonly placements?: readonly DataDeletionPlacement[];
  readonly backendReleases: readonly { backendId: string; bytes: number; transfers: number }[];
  readonly objectsPresent: boolean;
  readonly digest: string;
  readonly count: number;
  readonly compacted: boolean;
  readonly nativeHistory?: DataDeletionNativeHistory;
}
/** Captured native history must cover every original project prefix and every version, including uncertain PUTs. */
export interface DataDeletionPhysics {
  inspect(target: ProjectDeletionTarget, scope: DataDeletionScope): Promise<Pick<ProjectDeletionInventory, 'complete' | 'references' | 'blockers'> & { identity: string; nativeHistory?: DataDeletionNativeHistory; count?: number }>;
  run(context: ProjectDeletionContext, scope: DataDeletionScope, sourceIdentity: string): Promise<ProjectDeletionStepResult & { sourceIdentity?: string; scopeDigest?: string; producersClosed?: boolean; consumersStopped?: boolean; independent?: boolean; remaining?: number }>;
}
export interface DataProjectDeletion { readonly sources: DataDeletionSources; readonly physics?: DataDeletionPhysics }
export type DataProjectDeletionOwner = ProjectDeletionOwner;
export interface DataDeletionRepository {
  inspect(target: ProjectDeletionTarget): Promise<{ inventory: ProjectDeletionInventory }>;
  seal(context: ProjectDeletionContext): Promise<boolean | 'waiting'>;
  read(context: ProjectDeletionContext): Promise<{ scope: DataDeletionScope; proofs: Partial<Record<ProjectDeletionPhase, ProjectDeletionEvidence>>; sourceIdentity: string | null }>;
  record(context: ProjectDeletionContext, evidence: ProjectDeletionEvidence): Promise<void>;
}
