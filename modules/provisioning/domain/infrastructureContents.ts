import type { ProjectDeletionInventory, ProjectId } from '@crewstation/contracts';
import type { InfrastructureOriginDocument } from './infrastructureOrigins';

/** Private payloads are consumed only while classifying a complete read snapshot. */
export interface InfrastructureContentRow {
  readonly id: string;
  readonly birthDigest: string;
  readonly contentDigest: string;
  readonly document: InfrastructureOriginDocument;
  readonly deadLetters: number;
}
export interface InfrastructureOrphanError {
  readonly eventId: string;
  readonly consumer: string;
  readonly digest: string;
}
export interface OwnedInfrastructureContent {
  readonly channel: 'queue' | 'event';
  readonly id: string;
  readonly birthDigest: string;
  readonly contentDigest: string;
  readonly ownershipDigest: string;
  readonly projectIds: readonly ProjectId[];
  readonly deadLetters: number;
}
export interface InfrastructureContentInventory {
  readonly inventory: ProjectDeletionInventory;
  /** Minimum confirmed row origins, never payloads, error text, trace or lease credentials. */
  readonly contents: readonly OwnedInfrastructureContent[];
  readonly traversal: {
    readonly queue: boolean;
    readonly event: boolean;
    readonly orphanErrors: boolean;
    readonly scanned: { readonly queue: number; readonly event: number; readonly orphanErrors: number };
    readonly digest: string;
  };
}
