import type { ArchiveExecution } from '../domain/archiveExecution';
import type { LedgerRecordRef } from './ledger';

export interface ArchiveCredentials {
  issue(input: { id: string; bindingId: string; revision: number; consumerId: string; expiresAt: string }): Promise<{ token: string }>;
  close(id: string): Promise<void>;
  bind(id: string, podUid: string): Promise<void>;
}
export interface ArchiveExecutionStore {
  get(id: string): Promise<ArchiveExecution | undefined>;
  active(taskId: string): Promise<ArchiveExecution | undefined>;
  list(after?: string): Promise<readonly ArchiveExecution[]>;
  prepare(candidate: ArchiveExecution): Promise<ArchiveExecution>;
  admit(id: string): Promise<ArchiveExecution>;
  bind(id: string, podUid: string, secretUid: string): Promise<void>;
  stopping(id: string): Promise<void>;
  stopped(id: string): Promise<void>;
  record(id: string): Promise<LedgerRecordRef | undefined>;
}
