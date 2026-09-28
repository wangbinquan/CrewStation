import type { AcceptedArchiveFinalization, AcceptedArchiveRevision, ArchiveReceiptItem, BusinessOutcome, FinalizationArchive, ObjectStorageBlocker, ProjectId, ServiceId } from '@crewstation/contracts';
import type { FinalizationBinding } from '../domain/objectStorage';
import type { UploadAuthority } from './objectStorage';
import type { ArchiveArtifactDeletion, DeleteArchiveArtifacts, UserId } from '@crewstation/contracts';

export interface PrepareArchiveBinding {
  readonly id: string; readonly spaceId: string; readonly taskId: string; readonly taskGeneration: number;
  readonly volumeUid: string | null; readonly outcome: BusinessOutcome; readonly archive: FinalizationArchive;
}
export interface ArchiveCompletion {
  readonly receiptId: string; readonly stopProofDigest: string; readonly completionProofDigest: string;
  readonly disposition: 'archived' | 'empty' | 'never-provisioned'; readonly items: readonly ArchiveReceiptItem[];
}
/** Internal finalization authority. Public callers cannot synthesize a receipt or delete permit. */
export interface ArchiveBindingRepository {
  deleteArtifacts(id: string, input: DeleteArchiveArtifacts, scope: { spaceId: string; taskId: string; actorId: UserId }): Promise<ArchiveArtifactDeletion>;
  confirmLossStops(id: string, revision: number, evidence: { stopProofDigest: string; completionProofDigest: string | null }): Promise<FinalizationBinding>;
  reviseAccepted(change: AcceptedArchiveRevision, original?: AcceptedArchiveFinalization): Promise<FinalizationBinding>;
  prepare(input: PrepareArchiveBinding, authority: UploadAuthority): Promise<FinalizationBinding>;
  /** Only used after looking up the irreversible business intake; never accepts caller-provided authority. */
  prepareAccepted(input: PrepareArchiveBinding, scope: { projectId: ProjectId; serviceId: ServiceId }): Promise<FinalizationBinding>;
  get(id: string): Promise<FinalizationBinding | undefined>;
  observe(id: string, revision: number, sequence: number, observation: ObjectStorageBlocker | null): Promise<boolean>;
  confirm(id: string, revision: number): Promise<FinalizationBinding>;
  abort(id: string, revision: number): Promise<FinalizationBinding>;
  revise(id: string, input: { expectedRevision: number; requestKey: string; archive: FinalizationArchive; reason: string; confirmDiscard?: boolean }, authority: UploadAuthority): Promise<FinalizationBinding>;
  receipt(id: string, revision: number, input: ArchiveCompletion): Promise<FinalizationBinding>;
  permitDeletion(id: string, revision: number, permitId: string): Promise<FinalizationBinding>;
  reclaimed(id: string, permitId: string, proofId: string): Promise<FinalizationBinding>;
}
