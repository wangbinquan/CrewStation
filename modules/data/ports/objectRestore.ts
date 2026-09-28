import type { RegisterObjectBackend } from '@crewstation/contracts';
import type { StoredBackup, RestorePlacement, VerifiedBackupBundle, BackupObjectEntry } from './objectBackups';
import type { ObjectBytes } from './objectStorage';

export interface ObjectRestoreDestination extends Pick<RegisterObjectBackend, 'endpoint' | 'region' | 'bucket' | 'accessKeyId' | 'secretAccessKey' | 'monitoring'> { readonly backendId: string }
export interface ObjectRestorePlane {
  prepareRestore(input: readonly (ObjectRestoreDestination & RestorePlacement)[], signal: AbortSignal): Promise<{ commit(transaction: object): Promise<void>; bytes: ObjectBytes }>;
}
export interface ObjectRestoreRepository {
  placements(id: string): Promise<readonly RestorePlacement[]>;
  prepare(id: string, requestKey: string, digest: string, placements: readonly RestorePlacement[], apply: (transaction: object) => Promise<void>): Promise<StoredBackup>;
  activate(id: string, digest: string, manifestDigest: string, objectCount: number, bytes: number): Promise<void>;
}
export interface RestorableBundle extends VerifiedBackupBundle { content(item: BackupObjectEntry): Promise<ReadableStream<Uint8Array>> }
