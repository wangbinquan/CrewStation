import type { ProjectId } from '@crewstation/contracts';
import type { NativeDdlConnection, NativePostgresProcess } from './databaseRemoval';

export interface NativePostgresVolumeSource {
  readonly pvcUid: string; readonly pvUid: string; readonly nodeUid: string;
  readonly mountPath: string; readonly providerPath: string;
  readonly rootEpoch: string; readonly volumeEpoch: string;
  readonly entries: readonly { key: string; relativePath: string; kind: 'file' | 'directory'; identity: string }[];
}
export interface NativePostgresStorageSource {
  readonly identity: string;
  readonly serviceUid: string;
  readonly volumes: readonly NativePostgresVolumeSource[];
  /** Current observer only; a normal server restart can prove the same original volume again. */
  readonly server: { readonly podUid: string; readonly containerId: string; readonly nodeUid: string; readonly address: string };
  readonly observedAt: string;
}
/** Trusted original connection only. SQL fingerprints never substitute for independent volume epochs. */
export interface NativePostgresSource {
  capture(connection: NativeDdlConnection): Promise<NativePostgresStorageSource>;
  verify(connection: NativeDdlConnection, original: NativePostgresStorageSource): Promise<void>;
}

export interface NativePostgresCatalogIdentity { readonly kind: 'database' | 'role'; readonly name: string; readonly oid: string }
export interface NativePostgresJournalRecord {
  readonly workId: string; readonly resourceId: string; readonly projectId: ProjectId; readonly names: readonly string[];
  readonly state: 'running' | 'finished'; readonly journalVersion: 1 | null;
  readonly nativeSession: { readonly pid: number; readonly started: string; readonly sourceIdentity: string } | null;
  readonly process: NativePostgresProcess | null; readonly proofDigest: string | null;
  /** NULL means unrecorded, not an empty catalog or a physically verified absence. */
  readonly before: { readonly catalog: readonly NativePostgresCatalogIdentity[]; readonly storage: NativePostgresStorageSource | null } | null;
  readonly after: { readonly catalog: readonly NativePostgresCatalogIdentity[]; readonly storage: NativePostgresStorageSource | null } | null;
}
export interface NativePostgresJournal {
  /** Complete retained callback history in one read-only snapshot, including legacy gaps and running work. */
  read(projectId: ProjectId): Promise<{ readonly retainedRecordsComplete: true; readonly records: readonly NativePostgresJournalRecord[]; readonly revision: string }>;
}
