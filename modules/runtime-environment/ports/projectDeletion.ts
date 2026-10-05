import type { ProjectDeletionBlocker, ProjectDeletionContext, ProjectDeletionEvidence, ProjectDeletionInventory, ProjectDeletionTarget } from '@crewstation/contracts';
import type { RuntimeImageProjectContent } from './repositories';

import type { RUNTIME_IMAGE_PHYSICAL_KINDS } from '../domain/records';
export { RUNTIME_IMAGE_PHYSICAL_KINDS } from '../domain/records';
export interface RuntimeImagePhysicalScope {
  readonly version: 1; readonly projectId: string; readonly originDigest: string;
  readonly source: { readonly identity: string; readonly epoch: string; readonly version: string };
  /** Retained original native graph survives catalog removal and worker restart. */
  readonly nativeHistory?: { readonly version: 1; readonly identity: string; readonly digest: string; readonly body: unknown };
  /** Native identities stay independent; known builders/validations/journals also bind their immutable input identity. */
  readonly objects: readonly { kind: typeof RUNTIME_IMAGE_PHYSICAL_KINDS[number]; id: string; identity: string; sourceIdentity: string; count: number; consumerId?: string; consumerIdentity?: string }[];
  /** Even an empty category requires a complete independent scan. */
  readonly coverage: readonly { kind: typeof RUNTIME_IMAGE_PHYSICAL_KINDS[number]; identity: string; complete: true }[];
}
export interface RuntimeImagePhysicalReport {
  readonly complete: boolean; readonly blockers: readonly ProjectDeletionBlocker[];
  readonly references: readonly ProjectDeletionInventory['references'][number][];
}
export type RuntimeImagePhysicalProof =
  | { readonly kind: 'waiting'; readonly reason: string }
  | { readonly kind: 'blocked'; readonly blockers: readonly ProjectDeletionBlocker[] }
  | { readonly kind: 'done'; readonly digest: string; readonly scopeDigest: string; readonly sourceIdentity: string;
      readonly independent: boolean; readonly producersClosed: boolean; readonly consumersStopped: boolean;
      readonly nativeRemaining: number; readonly storageRemaining: number;
      readonly callbackExits: readonly { id: string; originalIdentity: string; digest: string }[] };
/** Must include old project prefixes, orphan uploads/cache and original consumers; catalog retirement is not reclamation. */
export interface RuntimeImageDeletionPhysics {
  capture(target: ProjectDeletionTarget, content: RuntimeImageProjectContent): Promise<RuntimeImagePhysicalReport & { scope: RuntimeImagePhysicalScope | null }>;
  inspect(scope: RuntimeImagePhysicalScope): Promise<RuntimeImagePhysicalReport>;
  stop(context: ProjectDeletionContext, scope: RuntimeImagePhysicalScope): Promise<RuntimeImagePhysicalProof>;
  purge(context: ProjectDeletionContext, scope: RuntimeImagePhysicalScope): Promise<RuntimeImagePhysicalProof>;
  prove(scope: RuntimeImagePhysicalScope): Promise<RuntimeImagePhysicalProof>;
}
export interface RuntimeImageDeletionScope {
  readonly version: 1; readonly target: { projectId: string; namespace: string; serviceId?: string };
  readonly inventory: ProjectDeletionInventory; readonly content: RuntimeImageProjectContent; readonly physical: RuntimeImagePhysicalScope | null;
}
export interface RuntimeImageDeletionStored {
  readonly scope: RuntimeImageDeletionScope; readonly verified: boolean; readonly phaseIndex: number;
  readonly receipts: Readonly<Partial<Record<ProjectDeletionContext['phase'], ProjectDeletionEvidence>>>;
}
export interface RuntimeImageDeletionRepository {
  content(target: ProjectDeletionTarget): Promise<RuntimeImageProjectContent>;
  retained(target: ProjectDeletionTarget): Promise<RuntimeImageDeletionScope | undefined>;
  seal(context: ProjectDeletionContext, scope: RuntimeImageDeletionScope): Promise<boolean | 'waiting'>;
  load(context: ProjectDeletionContext): Promise<RuntimeImageDeletionStored>;
  callbacksExited(context: ProjectDeletionContext): Promise<boolean>;
  recoverCallbacks(context: ProjectDeletionContext, proof: Extract<RuntimeImagePhysicalProof, { kind: 'done' }>): Promise<void>;
  advance(context: ProjectDeletionContext, evidence: ProjectDeletionEvidence): Promise<void>;
  purgeMetadata(context: ProjectDeletionContext): Promise<ProjectDeletionEvidence>;
}
