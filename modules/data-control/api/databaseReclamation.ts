/** Public native PostgreSQL locations only; no database contents or administrator credentials. */
import type postgres from 'postgres';

export interface NativeDdlConnection {
  query<T extends postgres.Row[] = postgres.Row[]>(text: string, parameters?: readonly (string | number | boolean | null)[]): Promise<T>;
  assertHeld(): Promise<void>;
}
export interface PostgresDatabaseDirectory {
  readonly tablespaceOid: string | null;
  readonly root: string;
}
export interface OriginalPostgresDatabase {
  readonly name: string;
  readonly oid: string;
  readonly source: string;
  readonly directories: readonly PostgresDatabaseDirectory[];
  readonly identity: string;
}
export type PostgresDatabaseReclamation =
  | { readonly kind: 'replaced'; readonly observedAt: string }
  | { readonly kind: 'present'; readonly catalogPresent: boolean; readonly remainingDirectories: number; readonly observedAt: string }
  | { readonly kind: 'gone'; readonly identity: string; readonly digest: string; readonly observedAt: string };

/** Read-only physical proof. The owner must separately authorize deletion and drain actual writers. */
export interface DatabaseReclamationReader {
  capture(target: { readonly name: string; readonly oid: string }): Promise<OriginalPostgresDatabase>;
  verify(original: OriginalPostgresDatabase): Promise<PostgresDatabaseReclamation>;
  close(): Promise<void>;
  /** Formal purge pins every catalog/filesystem query to the actual original native backend. */
  using?(connection: NativeDdlConnection): Pick<DatabaseReclamationReader, 'capture' | 'verify'>;
}
