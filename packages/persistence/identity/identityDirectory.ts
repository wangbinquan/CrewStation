import { sql } from 'drizzle-orm';
import { newResourceId } from '@crewstation/kernel';
import type { Database } from '../connection';
import type { MigrationSet } from '../migrations';
import { qualifiedTable } from './databaseRewrite';
import { identityKey, UUID_V7_PATTERN } from './identityMap';

/** Only explicit legacy boundaries use this directory; normal repositories never resolve names. */
export interface ResourceIdentityDirectory {
  resolve(kind: string, keys: readonly string[]): Promise<string | undefined>;
  aliases(kind: string, id: string): Promise<readonly string[][]>;
  bind(owner: string, kind: string, keys: readonly string[], canonicalId?: string): Promise<string>;
}

export function resourceIdentityDirectory(db: Database, migrations: () => readonly MigrationSet[]): ResourceIdentityDirectory {
  const schemas = () => [...new Set(migrations().flatMap((set) => set.files.flatMap((file) => 'identity' in file ? [file.identity.schema] : [])))];
  const table = (schema: string) => qualifiedTable(schema, 'resource_identity_aliases');
  return {
    resolve: async (kind, keys) => {
      const found = new Set<string>();
      for (const schema of schemas()) {
        const rows = await db.execute(sql`SELECT id FROM ${table(schema)} WHERE kind = ${kind} AND key = ${identityKey(keys)}`) as unknown as { id: string }[];
        for (const row of rows) found.add(row.id);
      }
      if (found.size > 1) throw new Error(`Ambiguous legacy resource identity: ${kind}`);
      return found.values().next().value;
    },
    aliases: async (kind, id) => {
      const found = new Set<string>();
      for (const schema of schemas()) {
        const rows = await db.execute(sql`SELECT key FROM ${table(schema)} WHERE kind = ${kind} AND id = ${id}`) as unknown as { key: string }[];
        for (const row of rows) found.add(row.key);
      }
      return [...found].map((key) => JSON.parse(key) as string[]);
    },
    bind: async (owner, kind, keys, canonicalId) => {
      if (!schemas().includes(owner)) throw new Error(`Unknown identity owner: ${owner}`);
      if (canonicalId && !UUID_V7_PATTERN.test(canonicalId)) throw new Error('Invalid canonical resource identity');
      // A late frame from an authenticated old process gets one durable, scoped identity.
      const rows = await db.execute(sql`INSERT INTO ${table(owner)} (kind, key, id) VALUES (${kind}, ${identityKey(keys)}, ${canonicalId ?? newResourceId()})
        ON CONFLICT (kind, key) DO UPDATE SET key = EXCLUDED.key RETURNING id`) as unknown as { id: string }[];
      if (canonicalId && rows[0]!.id !== canonicalId) throw new Error(`Conflicting legacy resource alias: ${kind}`);
      return rows[0]!.id;
    },
  };
}
