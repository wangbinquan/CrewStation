import { sql } from 'drizzle-orm';
import type { Executor } from './databaseTypes';

export interface ReportWorkingRow<T = unknown> { readonly key: string; readonly document: T }
export interface ReportWorkingPage<T = unknown> { readonly items: readonly ReportWorkingRow<T>[]; readonly nextCursor: string | null }
/** Connection-private derived rows, never a second source ledger. Every page has affirmative EOF. */
export interface ReportWorkspace {
  insert(namespace: string, rows: readonly ReportWorkingRow[]): Promise<void>;
  put(namespace: string, row: ReportWorkingRow): Promise<void>;
  upsert(namespace: string, rows: readonly ReportWorkingRow[]): Promise<void>;
  get<T>(namespace: string, key: string): Promise<T | undefined>;
  getMany<T>(namespace: string, keys: readonly string[]): Promise<readonly ReportWorkingRow<T>[]>;
  page<T>(namespace: string, after: string | null, size?: number): Promise<ReportWorkingPage<T>>;
  clear(namespace: string): Promise<void>;
  clearTree(namespace: string): Promise<void>;
}
function encoded(row: ReportWorkingRow) {
  const document = JSON.stringify(row.document);
  if (!row.key || document === undefined) throw new Error('Report workspace row is invalid');
  return { key: row.key, document };
}
/** The single fixed TEMP table is created by reportSnapshot before its read-only input transaction. */
export function privateReportWorkspace(db: Executor, active: () => boolean, signal?: AbortSignal): ReportWorkspace {
  const check = (namespace: string) => { if (!active()) throw new Error('Report snapshot already closed'); if (!namespace) throw new Error('Report workspace namespace is empty'); signal?.throwIfAborted(); };
  return {
    async insert(namespace, rows) {
      check(namespace); if (rows.length > 500) throw new Error('Report workspace insert batch is too large');
      if (!rows.length) return;
      const entries = rows.map(encoded);
      await db.execute(sql`INSERT INTO pg_temp.cs_report_workspace (namespace,key,document) VALUES ${sql.join(entries.map((r) => sql`(${namespace},${r.key},${r.document})`),sql`,`)}`);
    },
    async upsert(namespace, rows) {
      check(namespace); if (rows.length > 500) throw new Error('Report workspace upsert batch is too large');
      if (!rows.length) return;
      const entries = rows.map(encoded);
      await db.execute(sql`INSERT INTO pg_temp.cs_report_workspace (namespace,key,document) VALUES ${sql.join(entries.map((r) => sql`(${namespace},${r.key},${r.document})`),sql`,`)} ON CONFLICT(namespace,key) DO UPDATE SET document=excluded.document`);
    },
    async put(namespace, row) {
      check(namespace); const r = encoded(row);
      await db.execute(sql`INSERT INTO pg_temp.cs_report_workspace (namespace,key,document) VALUES (${namespace},${r.key},${r.document}) ON CONFLICT(namespace,key) DO UPDATE SET document=excluded.document`);
    },
    async get<T>(namespace: string, key: string): Promise<T | undefined> {
      check(namespace);
      const rows = await db.execute(sql`SELECT document FROM pg_temp.cs_report_workspace WHERE namespace=${namespace} AND key=${key}`);
      return rows.length ? JSON.parse(String(rows[0]!['document'])) as T : undefined;
    },
    async getMany<T>(namespace: string, keys: readonly string[]): Promise<readonly ReportWorkingRow<T>[]> {
      check(namespace); if (keys.length>500 || keys.some(key=>!key)) throw new Error('Report workspace lookup batch is invalid');
      if (!keys.length) return [];
      const rows=await db.execute(sql`SELECT key,document FROM pg_temp.cs_report_workspace WHERE namespace=${namespace} AND key IN (${sql.join(keys.map(key=>sql`${key}`),sql`,`)}) ORDER BY key`);
      return rows.map(row=>({key:String(row['key']),document:JSON.parse(String(row['document'])) as T}));
    },
    async page<T>(namespace: string, after: string | null, size = 100): Promise<ReportWorkingPage<T>> {
      check(namespace); if (!Number.isInteger(size) || size < 1 || size > 500) throw new Error('Report workspace page size is invalid');
      const rows = await db.execute(sql`SELECT key,document FROM pg_temp.cs_report_workspace WHERE namespace=${namespace} AND ${after === null ? sql`true` : sql`key>${after}`} ORDER BY key LIMIT ${size+1}`);
      const selected = rows.slice(0,size);
      return { items: selected.map((r) => ({ key: String(r['key']), document: JSON.parse(String(r['document'])) as T })), nextCursor: rows.length > size ? String(selected.at(-1)!['key']) : null };
    },
    async clear(namespace) { check(namespace); await db.execute(sql`DELETE FROM pg_temp.cs_report_workspace WHERE namespace=${namespace}`); },
    async clearTree(namespace) { check(namespace); await db.execute(sql`DELETE FROM pg_temp.cs_report_workspace WHERE namespace=${namespace} OR left(namespace,length(${namespace})+1)=${namespace}||'/'`); },
  };
}
