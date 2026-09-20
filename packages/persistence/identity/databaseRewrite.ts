import { sql } from 'drizzle-orm';
import { jsonHash } from '@crewstation/kernel';
import type { IdentityExecutor, ResourceIdentityMigration } from './model';
import type { ResourceIdentityMap } from './identityMap';
import { matchesIdentityCondition, setIdentityFields, transformIdentityDocument } from './documentTransform';

export const qualifiedTable = (schema: string, table: string) => sql`${sql.identifier(schema)}.${sql.identifier(table)}`;
export const readIdentityJson = (value: unknown): unknown => typeof value === 'string' ? JSON.parse(value) : value;

export function rowIdentityKeys(row: Record<string, unknown>, columns: readonly string[]): string[] {
  return columns.map((column) => {
    if (typeof row[column] === 'number' && Number.isSafeInteger(row[column])) return String(row[column]);
    if (typeof row[column] !== 'string') throw new Error(`Identity key column ${column} must contain a string`);
    return row[column];
  });
}

export async function readIdentityRows(db: IdentityExecutor, schema: string, table: string): Promise<Record<string, unknown>[]> {
  return await db.execute(sql`SELECT *, ctid::text AS __identity_locator FROM ${qualifiedTable(schema, table)}`) as unknown as Record<string, unknown>[];
}

/** All fields of a row are resolved from its original values and updated in one statement. */
export async function rewriteIdentityTables(db: IdentityExecutor, definition: ResourceIdentityMigration, identities: ResourceIdentityMap): Promise<number> {
  const tables = new Set([...definition.entities, ...definition.references, ...(definition.documents ?? [])].map((entry) => entry.table));
  let updated = 0;
  for (const table of tables) {
    for (const row of await readIdentityRows(db, definition.schema, table)) {
      const columns = new Map<string, ReturnType<typeof sql>>();
      for (const entity of definition.entities.filter((entry) => entry.table === table && matchesIdentityCondition(row, entry.where))) {
        if (entity.nullable && entity.keys.some((key) => row[key] === null || row[key] === undefined)) continue;
        columns.set(entity.idColumn, sql`${identities.resolve(entity.kind, rowIdentityKeys(row, entity.keys))}`);
      }
      for (const reference of definition.references.filter((entry) => entry.table === table && matchesIdentityCondition(row, entry.where))) {
        if (reference.nullable && reference.keys.some((key) => row[key] === null || row[key] === undefined)) continue;
        const keys = reference.keyOverride && reference.keyOverride.when === row[reference.column] ? reference.keyOverride.keys : reference.keys;
        columns.set(reference.column, sql`${identities.resolve(reference.kind, rowIdentityKeys(row, keys), `${definition.schema}.${table}.${reference.column}`)}`);
      }
      for (const document of (definition.documents ?? []).filter((entry) => entry.table === table && matchesIdentityCondition(row, entry.where))) {
        if (row[document.column] === null || row[document.column] === undefined) continue;
        const normalized = transformIdentityDocument(readIdentityJson(row[document.column]), document.references, row, identities, document.renames, `${definition.schema}.${table}.${document.column}`);
        setIdentityFields(normalized, document.set);
        if (document.provenanceColumn) {
          columns.set(document.provenanceColumn, sql`${JSON.stringify({ version: definition.version, sourceColumn: document.column, originalHash: jsonHash(readIdentityJson(row[document.column])), normalizedHash: jsonHash(normalized) })}::text::jsonb`);
        }
        columns.set(document.targetColumn ?? document.column, sql`${JSON.stringify(normalized)}::text::jsonb`);
      }
      if (!columns.size) continue;
      const assignments = [...columns].map(([column, value]) => sql`${sql.identifier(column)} = ${value}`);
      await db.execute(sql`UPDATE ${qualifiedTable(definition.schema, table)} SET ${sql.join(assignments, sql`, `)} WHERE ctid = ${row.__identity_locator as string}::tid`);
      updated += 1;
    }
  }
  return updated;
}
