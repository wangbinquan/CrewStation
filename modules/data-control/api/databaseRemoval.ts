import type { ProjectDeletionContext, ProjectId } from '@crewstation/contracts';
import type postgres from 'postgres';
import type { OriginalPostgresDatabase, PostgresDatabaseReclamation } from './databaseReclamation';

export type PostgresDatabaseRemoval =
  | { readonly kind: 'waiting'; readonly reason: 'native-consumers' | 'original-files' }
  | { readonly kind: 'gone'; readonly proof: Extract<PostgresDatabaseReclamation, { kind: 'gone' }> };

/** Internal purge primitive. A complete owner must first seal and drain every original writer. */
export interface DatabaseRemoval {
  remove(context: ProjectDeletionContext, original: OriginalPostgresDatabase): Promise<PostgresDatabaseRemoval>;
}

/** Internal original-session DDL port; the composition root supplies project ownership. */
export interface NativePostgresOrigin { readonly projectId: ProjectId; readonly resourceId: string }
export interface NativeDdlConnection {
  query<T extends postgres.Row[] = postgres.Row[]>(text: string, parameters?: readonly (string | number | boolean | null)[]): Promise<T>;
  assertHeld(): Promise<void>;
}
export interface NativePostgresWork {
  run<T>(origin: NativePostgresOrigin, names: readonly string[], effect: (connection: NativeDdlConnection) => Promise<T>): Promise<T>;
  /** Optional on a lock-only fixture; production composition persists encrypted credentials first. */
  credential?(origin: NativePostgresOrigin, role: string): Promise<{ role: string; password: string }>;
}
export interface NativePostgresProcess { readonly podUid: string; readonly containerId: string; readonly nodeUid: string; readonly nodeName: string }
export interface NativePostgresProcesses {
  protectCurrent(): Promise<NativePostgresProcess>;
  sweep(accept: { stopped(process: NativePostgresProcess, proofDigest: string): Promise<void>; releasable(podUid: string): Promise<boolean> }): Promise<void>;
}

export interface OriginalPostgresRole { readonly name: string; readonly oid: string; readonly source: string; readonly identity: string }
export type PostgresRoleRemoval =
  | { readonly kind: 'waiting'; readonly reason: 'native-consumers' | 'native-dependencies' }
  | { readonly kind: 'gone'; readonly identity: string; readonly digest: string };
export interface RoleRemoval {
  capture(target: { name: string; oid: string }): Promise<OriginalPostgresRole>;
  remove(context: ProjectDeletionContext, original: OriginalPostgresRole, peers: readonly OriginalPostgresRole[]): Promise<PostgresRoleRemoval>;
}
