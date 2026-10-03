import { precondition } from '@crewstation/kernel';
import type { Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { RUNTIME_CONTENT } from './contentTables';

export type RuntimeRawRow = Readonly<Record<string, unknown>>;
export interface RuntimeContentRow extends Record<string, unknown> { key: string; digest: string; body: RuntimeRawRow; invalid: boolean }
export type RuntimeContentTable = typeof RUNTIME_CONTENT[number];
export function runtimeContentKey(entry: RuntimeContentTable) {
  return sql.raw('jsonb_build_array(' + entry.keys.map((name) => 'r.' + name).join(',') + ')::text');
}
export function runtimeDocumentInvalid(entry: RuntimeContentTable) {
  return sql.raw(entry.documents.map((name) => `(r.${name} IS NOT NULL AND jsonb_typeof(r.${name}) IS DISTINCT FROM 'object')`).join(' OR ') || 'false');
}
/** Reading a nullable JSON column through a truthy mapper would erase explicit malformed presence. */
export class RuntimeContentRows {
  private readonly cache = new Map<string, Promise<RuntimeRawRow | undefined>>();
  constructor(private readonly db: Executor) {}
  prime(table: string, row: RuntimeRawRow) {
    if (!['environments', 'environment_rebuilds', 'development_parent_endings'].includes(table)) return;
    const cacheKey = JSON.stringify([table, runtimeString(row['id'])]);
    if (!this.cache.has(cacheKey)) this.cache.set(cacheKey, Promise.resolve(row));
  }
  get(table: 'environments' | 'environment_rebuilds' | 'development_parent_endings', key: string) {
    const cacheKey = JSON.stringify([table, key]); let pending = this.cache.get(cacheKey);
    if (!pending) {
      const entry = RUNTIME_CONTENT.find((value) => value.table === table)!;
      pending = (async () => {
        const row = (await this.db.execute<{ body: RuntimeRawRow; invalid: boolean }>(sql`SELECT to_jsonb(r) AS body,${runtimeDocumentInvalid(entry)} AS invalid
          FROM ${sql.raw('task_runtime.' + table)} r WHERE id=${key}`))[0];
        if (row?.invalid) throw precondition('运行环境原内容存在显式无效的 JSON 关系');
        return row?.body;
      })();
      this.cache.set(cacheKey, pending);
    }
    return pending;
  }
}
export function runtimeObject(value: unknown): RuntimeRawRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw precondition('运行环境原内容关系必须是对象');
  return value as RuntimeRawRow;
}
export function runtimeString(value: unknown): string {
  if (typeof value !== 'string' || !value.length) throw precondition('运行环境原内容缺少完整原身份');
  return value;
}
