import type { ArchiveHelperFailure, ArchiveReceiptItem } from '@crewstation/contracts';

/** Platform-issued credentials authorize one immutable manifest revision, never a general object space. */
export interface ArchiveHelperGrant {
  readonly id: string;
  readonly bindingId: string;
  readonly revision: number;
  readonly consumerId: string;
  readonly podUid: string | null;
  readonly tokenHash: string;
  readonly expiresAt: string;
  readonly closedAt: string | null;
  readonly completedAt?: string;
  readonly failure?: ArchiveHelperFailure & { readonly at: string; readonly retryAt: string | null };
}
export interface ArchiveUploadIdentity {
  readonly bindingId: string;
  readonly revision: number;
  readonly path: string;
}
export interface ArchiveHelperAuthority extends ArchiveUploadIdentity { readonly grantId: string }
export interface ArchiveFileResult {
  readonly bindingId: string;
  readonly revision: number;
  readonly path: string;
  readonly item: ArchiveReceiptItem;
}
