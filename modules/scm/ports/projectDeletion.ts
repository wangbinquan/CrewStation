import type { ProjectDeletionBlocker, ProjectDeletionContext, ProjectDeletionInventory, ProjectId } from '@crewstation/contracts';
import type { ScmCurrentRepositoryOriginsWitness } from './currentRepositoryOrigins';

/** Coverage is explicit even for an empty category; repository API absence is never file absence. */
export const SCM_STORAGE_KINDS = ['repository', 'wiki', 'design', 'snippet', 'lfs', 'upload', 'artifact', 'trace', 'package', 'registry', 'secure-file'] as const;
export type ScmStorageKind = typeof SCM_STORAGE_KINDS[number];
export interface ScmDeletionPlan {
  readonly projectId: ProjectId;
  readonly serviceIds: readonly string[];
  readonly credentialIds: readonly string[];
  readonly repositories: readonly { remoteProjectId: string; pathWithNamespace: string; createdAt: string | null }[];
  readonly credentials: readonly { remoteProjectId: string; remoteTokenId: string; createdAt: string | null; userId: string | null }[];
  readonly currentOrigins?: ScmCurrentRepositoryOriginsWitness;
}
export interface ScmDeletionScope {
  readonly version: 1;
  readonly plan: ScmDeletionPlan;
  readonly source: { readonly identity: string; readonly epoch: string; readonly version: string };
  readonly repositories: readonly { remoteProjectId: string; pathWithNamespace: string; createdAt: string; identity: string }[];
  readonly objects: readonly { repositoryId: string; kind: ScmStorageKind; id: string; identity: string; sourceIdentity: string; count: number }[];
  readonly coverage: readonly { repositoryId: string; kind: ScmStorageKind; identity: string; complete: true }[];
}
export interface ScmDeletionSourceReport {
  readonly complete: boolean;
  readonly blockers: readonly ProjectDeletionBlocker[];
  readonly references: readonly ProjectDeletionInventory['references'][number][];
}
export type ScmDeletionProof =
  | { readonly kind: 'waiting'; readonly reason: string }
  | { readonly kind: 'blocked'; readonly blockers: readonly ProjectDeletionBlocker[] }
  | { readonly kind: 'done'; readonly digest: string; readonly scopeDigest: string; readonly sourceIdentity: string;
      readonly independent: boolean; readonly producersClosed: boolean; readonly consumersStopped: boolean;
      readonly nativeRemaining: number; readonly storageRemaining: number };
/** An independent native/filesystem source must keep querying the captured origins after native deletion. */
export interface ScmDeletionPhysics {
  capture(plan: ScmDeletionPlan): Promise<ScmDeletionSourceReport & { scope: ScmDeletionScope | null }>;
  inspect(scope: ScmDeletionScope): Promise<ScmDeletionSourceReport>;
  stop(context: ProjectDeletionContext, scope: ScmDeletionScope): Promise<ScmDeletionProof>;
  purge(context: ProjectDeletionContext, scope: ScmDeletionScope): Promise<ScmDeletionProof>;
  prove(scope: ScmDeletionScope): Promise<ScmDeletionProof>;
}
export interface ScmDeletionStored {
  readonly scope: ScmDeletionScope | null;
  readonly proofs: Partial<Record<'stop' | 'purge' | 'prove', string>>;
  readonly metadataPurged: boolean;
  readonly completed: { digest: string; count: number } | null;
}
export interface ScmDeletionRepository {
  retained(projectId: ProjectId): Promise<ScmDeletionScope | null>;
  load(context: ProjectDeletionContext): Promise<ScmDeletionStored>;
  bind(context: ProjectDeletionContext, scope: ScmDeletionScope): Promise<void>;
  record(context: ProjectDeletionContext, digest: string): Promise<void>;
  purgeMetadata(context: ProjectDeletionContext): Promise<void>;
  complete(context: ProjectDeletionContext, digest: string, count: number): Promise<void>;
}
