import type { ObjectBackupObservation, ObjectBackupRecord } from '@crewstation/contracts';
import type { StoredObjectRecord } from '../domain/objectStorage';

export interface StoredBackup extends ObjectBackupRecord {
  readonly restoreTarget?: { readonly requestKey: string; readonly digest: string; readonly placements: readonly RestorePlacement[]; readonly startedAt: string; readonly activatedAt?: string };
  readonly sourceDatabaseIdentity: string;
  readonly restoreVerifiedAt?: string;
  readonly restoreManifestDigest?: string;
  readonly requestKey: string;
  readonly requestDigest: string;
  readonly backendIds: readonly string[];
  readonly epoch: number;
}
export interface RestorePlacement { readonly backendId: string; readonly sourceRevision: number; readonly targetRevision: number; readonly endpoint?: string; readonly region?: string; readonly bucket?: string }
export interface ObjectBackupRepository {
  begin(input: { requestKey: string; destination: string; reason: string }): Promise<StoredBackup>;
  get(id: string): Promise<StoredBackup>;
  start(id: string): Promise<StoredBackup>;
  page(id: string, cursor?: string): Promise<StoredObjectRecord[]>;
  progress(id: string, objects: number, bytes: number): Promise<void>;
  finish(id: string, result: { manifestDigest: string; objectCount: number; bytes: number } | { errorCode: 'export_failed' | 'operator_aborted' }): Promise<StoredBackup>;
  observe(backendId: string): Promise<ObjectBackupObservation>;
  verifyRestored(id: string, manifestDigest: string, objectCount: number, bytes: number): Promise<void>;
  assertRestoreTarget(id: string): Promise<void>;
}
export type BackupObjectEntry = Pick<StoredObjectRecord, 'id' | 'spaceId' | 'backendId' | 'placementRevision' | 'key' | 'size' | 'sha256'>;
export interface VerifiedBackupBundle {
  readonly manifest: { backupId: string; objectCount: number; bytes: number };
  entries(): AsyncIterable<BackupObjectEntry>;
  verify(): Promise<unknown>;
}
export interface BackupBlobDigest { readonly size: number; readonly sha256: string }
export interface ObjectBackupSink {
  /** A consistent full CS PostgreSQL snapshot, with credentials kept outside argv/logs. */
  snapshot(signal: AbortSignal): Promise<BackupBlobDigest>;
  object(object: StoredObjectRecord, body: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<BackupBlobDigest>;
  /** Seal only after persisted files have been read back and verified. */
  seal(input: { backupId: string; snapshot: BackupBlobDigest; objectCount: number; bytes: number }, signal: AbortSignal): Promise<string>;
}
