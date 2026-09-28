import type { ArchiveReceiptDto, ObjectStorageBlocker } from '@crewstation/contracts';

export interface ArchiveBindingView {
  readonly id: string; readonly revision: number; readonly taskId: string; readonly taskGeneration: number; readonly volumeUid: string | null;
  readonly state: 'prepared' | 'bound' | 'receipted' | 'delete-started' | 'completed' | 'aborted';
  readonly manifestDigest: string; readonly receipt: ArchiveReceiptDto | null;
}
/** Internal worker API. It resolves authority from the durable intake, independent of a service's current lease. */
export interface ArchiveFinalizationApi {
  lossReceipt(id: string, revision: number): Promise<ArchiveReceiptDto | null>;
  revise(changeId: string): Promise<{ applied: boolean; binding: ArchiveBindingView }>;
  permitDeletion(id: string, revision: number, permitId: string): Promise<void>;
  reclaimed(id: string, permitId: string, proofId: string): Promise<void>;
  commitArchive(id: string, revision: number, evidence: { stopProofDigest: string; completionProofDigest: string | null }): Promise<ArchiveBindingView>;
  bind(id: string): Promise<ArchiveBindingView>;
  get(id: string): Promise<ArchiveBindingView | undefined>;
  observe(id: string, revision: number, sequence: number, observation: ObjectStorageBlocker | null): Promise<boolean>;
}
