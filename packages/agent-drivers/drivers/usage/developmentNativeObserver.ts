import { Database } from 'bun:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, lstatSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { DevelopmentNativeStoreSchema, sameDevelopmentNativeStore, type DevelopmentNativeStore, type DevelopmentNativeSourceIssue } from '@crewstation/contracts';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
interface Identity { canonical: string; actualPathDigest: string; fileIdentityDigest: string }
interface Binding { version: number; source_epoch: string; planned_digest: string; actual_digest: string; file_digest: string }
export interface DevelopmentNativeRead<T> { store: DevelopmentNativeStore; value?: T }
function identity(path: string): Identity {
  const canonical = realpathSync(path), stat = statSync(canonical, { bigint: true });
  if (!stat.isFile() || typeof stat.birthtimeNs !== 'bigint' || stat.birthtimeNs <= 0n) throw new Error('Native identity unavailable');
  return { canonical, actualPathDigest: digest(canonical), fileIdentityDigest: digest(JSON.stringify({ dev: String(stat.dev), ino: String(stat.ino), birthtimeNs: String(stat.birthtimeNs) })) };
}
function bind(db: Database, planned: string, actual: Identity): DevelopmentNativeStore {
  db.exec('CREATE TABLE IF NOT EXISTS development_native_source (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, source_epoch TEXT NOT NULL, planned_digest TEXT NOT NULL, actual_digest TEXT NOT NULL, file_digest TEXT NOT NULL)');
  const row = db.query<Binding, []>('SELECT version,source_epoch,planned_digest,actual_digest,file_digest FROM development_native_source WHERE id=1').get();
  if (row) {
    if (row.version !== 1 || !/^[a-f0-9]{64}$/.test(row.planned_digest)) throw new Error('Unsupported native binding');
    DevelopmentNativeStoreSchema.parse({ state: 'observed', sourceEpoch: row.source_epoch, actualPathDigest: row.actual_digest, fileIdentityDigest: row.file_digest });
    if (row.planned_digest === planned && row.actual_digest === actual.actualPathDigest && row.file_digest === actual.fileIdentityDigest) return { state: 'observed', sourceEpoch: row.source_epoch, actualPathDigest: actual.actualPathDigest, fileIdentityDigest: actual.fileIdentityDigest };
  }
  const sourceEpoch = randomUUID();
  db.query('INSERT OR REPLACE INTO development_native_source VALUES(1,1,?,?,?,?)').run(sourceEpoch, planned, actual.actualPathDigest, actual.fileIdentityDigest);
  return { state: 'observed', sourceEpoch, actualPathDigest: actual.actualPathDigest, fileIdentityDigest: actual.fileIdentityDigest };
}
// lstat also sees dangling symlinks; they must never create an unexpected sidecar target.
function assertSidecar(path: string): void {
  try { if (!lstatSync(path).isFile()) throw new Error('Sidecar must be a regular file'); }
  catch (error) { if ((error as { code?: string }).code !== 'ENOENT') throw error; }
}
/** One final-environment observer per turn. Its metadata cannot attest an upstream fd or exclude ABA. */
export class DevelopmentNativeObserver {
  readonly plannedPathDigest: string | null;
  readonly path: string | null;
  private store: DevelopmentNativeStore;
  private lastObserved: DevelopmentNativeStore | undefined;
  private readonly gaps = new Set<DevelopmentNativeSourceIssue>();
  private replaced = false;
  constructor(path: string | null) {
    this.path = path && isAbsolute(path) ? resolve(path) : null;
    this.plannedPathDigest = this.path ? digest(this.path) : null;
    this.store = this.path ? { state: 'pending' } : { state: 'unavailable' };
    if (!this.path) this.gaps.add('native-source-path-unavailable');
  }
  current(): DevelopmentNativeStore { return { ...this.store }; }
  issues(): DevelopmentNativeSourceIssue[] { return [...this.gaps]; }
  changed(): boolean { return this.replaced; }
  inspect(): DevelopmentNativeStore { return this.read(() => undefined).store; }
  read<T>(read: (path: string, sidecar: Database) => T): DevelopmentNativeRead<T> {
    if (!this.path || !this.plannedPathDigest) return { store: this.current() };
    let db: Database | undefined, phase: 'stat' | 'sidecar' | 'read' = 'stat', sampled = false;
    try {
      const before = identity(this.path), sidecar = this.path + '.crewstation-usage.sqlite'; sampled = true;
      phase = 'sidecar';
      assertSidecar(sidecar);
      db = new Database(sidecar); chmodSync(sidecar, 0o600);
      db.exec('PRAGMA busy_timeout = 0'); db.exec('BEGIN IMMEDIATE');
      const bound = bind(db, this.plannedPathDigest, before);
      phase = 'read'; const value = read(before.canonical, db);
      phase = 'stat'; const after = identity(this.path);
      if (before.actualPathDigest !== after.actualPathDigest || before.fileIdentityDigest !== after.fileIdentityDigest) {
        this.replaced = true; this.gaps.add('native-source-changed'); throw new Error('Native file changed during sample');
      }
      phase = 'sidecar'; db.exec('COMMIT');
      if (this.lastObserved && !sameDevelopmentNativeStore(this.lastObserved, bound)) { this.replaced = true; this.gaps.add('native-source-changed'); }
      this.lastObserved = bound; this.store = bound;
      return { store: this.current(), value };
    } catch (error) {
      try { db?.exec('ROLLBACK'); } catch { /* A failed BEGIN owns no transaction. */ }
      const missing = phase === 'stat' && (error as { code?: string }).code === 'ENOENT';
      if (missing && !sampled && !this.lastObserved && !this.replaced) this.store = { state: 'pending' };
      else {
        this.store = { state: 'unavailable' };
        this.gaps.add(phase === 'sidecar' ? 'native-source-sidecar-unavailable' : phase === 'read' ? 'native-source-read-failed' : 'native-source-stat-unavailable');
        if (missing && (sampled || this.lastObserved)) { this.replaced = true; this.gaps.add('native-source-changed'); }
      }
      return { store: this.current() };
    } finally { try { db?.close(); } catch { /* Observation cannot change model execution. */ } }
  }
}
