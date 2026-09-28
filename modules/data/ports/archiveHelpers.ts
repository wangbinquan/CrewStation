import type { ArchiveHelperFailure, ArchivePlanEntry } from '@crewstation/contracts';
import type { ArchiveFileResult, ArchiveHelperAuthority, ArchiveHelperGrant } from '../domain/archiveHelper';

export interface ArchiveHelperRepository {
  grant(input: ArchiveHelperGrant): Promise<void>;
  close(id: string): Promise<void>;
  bind(id: string, podUid: string): Promise<void>;
  authenticate(id: string, tokenHash: string, podUid: string): Promise<ArchiveHelperGrant>;
  complete(id: string, tokenHash: string, podUid: string): Promise<void>;
  completed(bindingId: string, revision: number): Promise<boolean>;
  fail(id: string, tokenHash: string, podUid: string, input: ArchiveHelperFailure): Promise<void>;
  failure(bindingId: string, revision: number): Promise<(ArchiveHelperFailure & { at: string; retryAt: string | null }) | undefined>;
  entries(grant: ArchiveHelperGrant, offset: number, limit: number): Promise<{ items: readonly ArchivePlanEntry[]; nextOffset: number | null }>;
  record(authority: ArchiveHelperAuthority, result: { objectId: string } | { omitted: 'not-found' }): Promise<ArchiveFileResult>;
  results(bindingId: string, revision: number): Promise<readonly ArchiveFileResult[]>;
}
