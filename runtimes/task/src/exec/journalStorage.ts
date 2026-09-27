import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RunnerCommandError, fsErrorCode } from '../commandError';

const missing = (): never => { throw new RunnerCommandError('execution_journal_lost', '执行日志丢失或已替换，拒绝创建空日志'); };
const markerName = 'journal.identity';

/** Separate durable identity prevents a surviving volume directory from silently creating an empty log. */
export function openJournalStorage(directory: string): Database {
  const owner = lstatSync(directory), filename = join(directory, 'executions.sqlite'), marker = join(directory, markerName);
  if (!owner.isDirectory() || (owner.mode & 0o077) !== 0 || owner.uid !== process.getuid?.()) throw new RunnerCommandError('journal_directory_unsafe', '执行日志需要 Runner 独占的私有目录');
  const hasFile = safeFile(filename, owner.uid), hasMarker = safeFile(marker, owner.uid);
  if (hasMarker && !hasFile) missing();
  const expected = hasMarker ? readIdentity(marker) : undefined;
  const db = new Database(filename, { create: !hasMarker, strict: true });
  try {
    db.exec('PRAGMA busy_timeout=2000;');
    if (expected) {
      let actual: string | undefined;
      try { actual = db.query<{ identity: string }, []>('SELECT identity FROM journal_identity WHERE singleton=1').get()?.identity; }
      catch { missing(); }
      if (actual !== expected) missing();
      db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    } else {
      db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
      const identity = initialize(db);
      // No execution can have been admitted before the constructor durably published its identity.
      // A missing marker with admitted executions is data loss, not an initialization retry.
      if (safeFile(marker, owner.uid)) { if (readIdentity(marker) !== identity) missing(); }
      else {
        if (db.query<{ count: number }, []>('SELECT count(*) AS count FROM executions').get()!.count > 0) missing();
        publishIdentity(directory, marker, identity);
      }
    }
    return db;
  } catch (error) { db.close(); throw error; }
}

function safeFile(filename: string, uid: number): boolean {
  try {
    const info = lstatSync(filename);
    if (!info.isFile() || info.uid !== uid || (info.mode & 0o022) !== 0) throw new RunnerCommandError('journal_directory_unsafe', '执行日志文件不安全');
    return true;
  } catch (error) { if (fsErrorCode(error) === 'ENOENT') return false; throw error; }
}

function readIdentity(filename: string): string {
  const info = lstatSync(filename);
  if (info.size !== 36) missing();
  const value = readFileSync(filename, 'utf8');
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value)) missing();
  return value;
}

function publishIdentity(directory: string, filename: string, identity: string): void {
  let fd: number;
  try { fd = openSync(filename, 'wx', 0o600); }
  catch (error) { if (fsErrorCode(error) !== 'EEXIST') throw error; if (readIdentity(filename) !== identity) missing(); return; }
  try { writeFileSync(fd, identity); fsyncSync(fd); } finally { closeSync(fd); }
  const parent = openSync(directory, 'r');
  try { fsyncSync(parent); } finally { closeSync(parent); }
}

function initialize(db: Database): string {
  return db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS journal_identity (singleton INTEGER PRIMARY KEY CHECK(singleton=1), identity TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS executions (
        execution_id TEXT PRIMARY KEY, attempt INTEGER NOT NULL, payload_digest TEXT NOT NULL,
        incarnation TEXT NOT NULL, phase TEXT NOT NULL, last_sequence INTEGER NOT NULL DEFAULT 0,
        acknowledged_sequence INTEGER NOT NULL DEFAULT 0, output_bytes INTEGER NOT NULL DEFAULT 0,
        spool_bytes INTEGER NOT NULL DEFAULT 0, result TEXT
      );
      CREATE TABLE IF NOT EXISTS events (
        execution_id TEXT NOT NULL, sequence INTEGER NOT NULL, occurred_at TEXT NOT NULL,
        body TEXT NOT NULL, bytes INTEGER NOT NULL, PRIMARY KEY(execution_id, sequence)
      );`);
    db.query('INSERT OR IGNORE INTO journal_identity(singleton,identity) VALUES(1,?)').run(randomUUID());
    return db.query<{ identity: string }, []>('SELECT identity FROM journal_identity WHERE singleton=1').get()!.identity;
  }).immediate();
}
