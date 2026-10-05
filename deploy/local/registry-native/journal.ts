import { Database } from 'bun:sqlite';
import { chmodSync, lstatSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { ProjectDeletionContextSchema } from '../../../packages/contracts';
import type { ProjectDeletionContext } from '../../../packages/contracts';
import { jsonHash, newResourceId } from '../../../packages/kernel';
import { captureRegistryHistory, registryHistoryIdentity } from '../../../packages/filesystem-metrics';
import type { RegistryDeletionHistory } from '../../../packages/filesystem-metrics';
import { RegistryOperatorBirthSchema } from './process/operatorExit';
import type { RegistryOperatorBirth } from './process/operatorExit';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const definitions = {
  registry_meta: `CREATE TABLE registry_meta(id INTEGER PRIMARY KEY CHECK(id=1),birth TEXT NOT NULL,source_identity TEXT NOT NULL,schema_hash TEXT NOT NULL)`,
  registry_work: `CREATE TABLE registry_work(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,operation_id TEXT NOT NULL,generation INTEGER NOT NULL,participant TEXT NOT NULL,history_identity TEXT NOT NULL,scope_digest TEXT NOT NULL,operator_identity TEXT NOT NULL,operator_birth TEXT,entered_at TEXT NOT NULL,exit_key_hash TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('running','finished','interrupted')),exited_at TEXT,exit_digest TEXT,CHECK((state='running')=(exited_at IS NULL)),CHECK((state='running')=(exit_digest IS NULL)))`,
  registry_exit: `CREATE TABLE registry_exit(id TEXT PRIMARY KEY,key_hash TEXT NOT NULL,operator_identity TEXT NOT NULL)`,
  registry_recovery: `CREATE TABLE registry_recovery(id TEXT PRIMARY KEY,operator_birth TEXT NOT NULL,exit_digest TEXT NOT NULL)`,
  registry_meta_update: `CREATE TRIGGER registry_meta_update BEFORE UPDATE ON registry_meta BEGIN SELECT RAISE(ABORT,'Original registry journal identity is immutable'); END`,
  registry_meta_delete: `CREATE TRIGGER registry_meta_delete BEFORE DELETE ON registry_meta BEGIN SELECT RAISE(ABORT,'Original registry journal identity is immutable'); END`,
  registry_work_delete: `CREATE TRIGGER registry_work_delete BEFORE DELETE ON registry_work BEGIN SELECT RAISE(ABORT,'Original registry work cannot be removed'); END`,
  registry_work_update: `CREATE TRIGGER registry_work_update BEFORE UPDATE ON registry_work WHEN
    OLD.state<>'running' OR NEW.state NOT IN('finished','interrupted') OR NEW.exited_at IS NULL OR NEW.exit_digest IS NULL
    OR (NEW.state='finished' AND NOT EXISTS(SELECT 1 FROM registry_exit WHERE id=OLD.id AND key_hash=OLD.exit_key_hash AND operator_identity=OLD.operator_identity))
    OR (NEW.state='interrupted' AND NOT EXISTS(SELECT 1 FROM registry_recovery WHERE id=OLD.id AND operator_birth=OLD.operator_birth AND exit_digest=NEW.exit_digest))
    OR NEW.id<>OLD.id OR NEW.project_id<>OLD.project_id OR NEW.operation_id<>OLD.operation_id OR NEW.generation<>OLD.generation OR NEW.participant<>OLD.participant
    OR NEW.history_identity<>OLD.history_identity OR NEW.scope_digest<>OLD.scope_digest OR NEW.operator_identity<>OLD.operator_identity OR NEW.operator_birth IS NOT OLD.operator_birth OR NEW.entered_at<>OLD.entered_at OR NEW.exit_key_hash<>OLD.exit_key_hash
    BEGIN SELECT RAISE(ABORT,'Registry work requires the original private finally'); END`,
};
const normalize = (text: string) => text.trim().replace(/\s+/g, ' ').replace(/;+$/, '');
const schemaIdentity = jsonHash(Object.entries(definitions).sort().map(([name, sql]) => [name, normalize(sql)]));
const birth = (file: string) => {
  const value = lstatSync(file, { bigint: true });
  if (!value.isFile() || value.isSymbolicLink() || value.nlink !== 1n || value.birthtimeNs <= 0n || value.mode & 0o022n) throw Error('Original private registry journal file is unsupported');
  return { device: String(value.dev), inode: String(value.ino), birth: String(value.birthtimeNs) };
};

/** Minimal durable native callback journal. A lost connection, restarted
 * operator or expired grant never changes an original running entry to zero. */
export function nativeRegistryJournal(file: string, rawSourceIdentity: string, runtime?: { original: RegistryOperatorBirth; proveExit(original: RegistryOperatorBirth): Promise<string | undefined> }) {
  const sourceIdentity = hash.parse(rawSourceIdentity), parent = lstatSync(dirname(file), { bigint: true });
  if (!isAbsolute(file) || !parent.isDirectory() || parent.isSymbolicLink() || parent.mode & 0o022n) throw Error('Private registry journal requires its original protected directory');
  try { birth(file); } catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error; }
  const db = new Database(file, { create: true, strict: true }), keys = new Map<string, string>(); let closed = false;
  db.exec('PRAGMA busy_timeout=2000; PRAGMA synchronous=FULL; PRAGMA journal_mode=WAL;');
  const version = (db.query('PRAGMA user_version').get() as { user_version: number }).user_version;
  if (version === 0) {
    if ((db.query("SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").all()).length) { db.close(); throw Error('Registry journal is an unknown existing database'); }
    db.transaction(() => {
      for (const sql of Object.values(definitions)) db.exec(sql);
      db.query('INSERT INTO registry_meta VALUES(1,?,?,?)').run(newResourceId(), sourceIdentity, schemaIdentity); db.exec('PRAGMA user_version=2');
    }).immediate();
  } else if (version !== 2) { db.close(); throw Error('Registry journal version is unsupported'); }
  chmodSync(file, 0o600); const original = birth(file), operator = jsonHash(randomBytes(32).toString('hex'));
  const schema = db.query("SELECT name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string; sql: string }[];
  const meta = db.query('SELECT * FROM registry_meta').all() as { id: number; birth: string; source_identity: string; schema_hash: string }[];
  if (meta.length !== 1 || meta[0]!.id !== 1 || meta[0]!.source_identity !== sourceIdentity || meta[0]!.schema_hash !== schemaIdentity
    || jsonHash(schema.map(row => [row.name, normalize(row.sql)])) !== schemaIdentity) { db.close(); throw Error('Original registry journal schema or source changed'); }
  if (db.query('SELECT id FROM registry_exit UNION ALL SELECT id FROM registry_recovery').all().length) { db.close(); throw Error('Original registry exit transaction is incomplete'); }
  const identity = jsonHash({ file: original, birth: meta[0]!.birth, sourceIdentity, schemaIdentity });
  const guard = () => { if (closed || jsonHash(birth(file)) !== jsonHash(original)) throw Error('Original registry journal has closed or been replaced'); };
  const status = () => {
    guard(); const row = db.query("SELECT COUNT(*) AS total,COALESCE(SUM(CASE WHEN state='running' THEN 1 ELSE 0 END),0) AS active FROM registry_work").get() as { total: number; active: number };
    guard(); return { version: 1 as const, identity, sourceIdentity, complete: true as const, active: row.active, total: row.total };
  };
  return { identity, sourceIdentity, status,
    begin: (rawContext: ProjectDeletionContext, rawHistory: RegistryDeletionHistory) => {
      const context = ProjectDeletionContextSchema.parse(structuredClone(rawContext)), history = captureRegistryHistory(rawHistory);
      if (history.projectId !== context.target.id || history.sourceIdentity !== sourceIdentity) throw Error('Registry journal work belongs to another original source or project');
      guard(); const id = newResourceId(), key = randomBytes(32).toString('hex');
      const scope = jsonHash({ operation: context.operationId, generation: context.generation, participant: context.confirmed.participant, history: registryHistoryIdentity(history) });
      db.transaction(() => {
        if (status().active) throw Error('An original registry reclamation still runs');
        db.query("INSERT INTO registry_work VALUES(?,?,?,?,?,?,?,?,?,?,?,'running',NULL,NULL)").run(id, context.target.id, context.operationId, context.generation, context.confirmed.participant,
          registryHistoryIdentity(history), scope, operator, runtime ? JSON.stringify(RegistryOperatorBirthSchema.parse(runtime.original)) : null, new Date().toISOString(), jsonHash(key));
      }).immediate(); keys.set(id, key);
      return { id, finish: () => {
        guard(); if (!keys.has(id)) throw Error('Original native callback finally was already consumed');
        db.transaction(() => {
          db.query('INSERT INTO registry_exit VALUES(?,?,?)').run(id, jsonHash(keys.get(id)!), operator);
          const result = db.query("UPDATE registry_work SET state='finished',exited_at=?,exit_digest=? WHERE id=? AND state='running'").run(new Date().toISOString(), jsonHash({ id, scope, operator, callbackExited: true }), id);
          if (result.changes !== 1) throw Error('Original registry callback exit was not durably recorded');
          db.query('DELETE FROM registry_exit WHERE id=?').run(id);
        }).immediate();
        keys.delete(id); guard();
      } };
    },
    recoverInterrupted: async () => {
      guard(); if (!runtime) return;
      const originals = db.query("SELECT id,operator_birth FROM registry_work WHERE state='running' AND operator_birth IS NOT NULL").all() as { id: string; operator_birth: string }[];
      for (const row of originals) {
        const original = RegistryOperatorBirthSchema.parse(JSON.parse(row.operator_birth)), exit = await runtime.proveExit(original); guard(); if (!exit) continue; hash.parse(exit);
        db.transaction(() => {
          db.query('INSERT INTO registry_recovery VALUES(?,?,?)').run(row.id, row.operator_birth, exit);
          const result = db.query("UPDATE registry_work SET state='interrupted',exited_at=?,exit_digest=? WHERE id=? AND state='running' AND operator_birth=?").run(new Date().toISOString(), exit, row.id, row.operator_birth);
          if (result.changes !== 1) throw Error('Original Registry operator recovery scope changed');
          db.query('DELETE FROM registry_recovery WHERE id=?').run(row.id);
        }).immediate();
      }
      guard();
    },
    close: () => { closed = true; keys.clear(); db.close(); },
  };
}
export type NativeRegistryJournal = ReturnType<typeof nativeRegistryJournal>;
