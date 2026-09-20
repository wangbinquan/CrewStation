import { sql } from 'drizzle-orm';
import type { IdentityExecutor, ResourceIdentityMigration } from './model';
import { identityValues, matchesIdentityCondition, referenceKeys, referenceValue } from './documentTransform';
import { qualifiedTable, readIdentityJson, readIdentityRows, rowIdentityKeys } from './databaseRewrite';

/** Source participants expose declared fields; only the owning participant writes the target table. */
export async function importIdentityDeclarations(db: IdentityExecutor, participants: readonly ResourceIdentityMigration[]): Promise<void> {
  const rows = new Map<string, Promise<Record<string, unknown>[]>>();
  const existingKeys = new Map<string, Set<string>>();
  const readRows = (schema: string, table: string) => {
    const key = `${schema}.${table}`;
    if (!rows.has(key)) rows.set(key, readIdentityRows(db, schema, table));
    return rows.get(key)!;
  };
  for (const source of participants) for (const declaration of source.declarations ?? []) {
    for (const row of await readRows(source.schema, declaration.table)) {
      if (!matchesIdentityCondition(row, declaration.where) || row[declaration.column] == null) continue;
      for (const match of identityValues(readIdentityJson(row[declaration.column]), declaration.path)) {
        if (!matchesIdentityCondition(match.parent, declaration.when) || (declaration.nullable && match.value == null)) continue;
        const owner = participants.find((participant) => participant.imports?.some((entity) => entity.kind === declaration.kind));
        const target = owner?.imports?.find((entity) => entity.kind === declaration.kind);
        if (!owner || !target) throw new Error(`No owning migration participant for declaration ${declaration.kind}`);
        const keys = referenceKeys(declaration, match, row);
        if (keys.length !== target.keys.length) throw new Error(`Declaration scope mismatch for ${declaration.kind}`);
        const table = qualifiedTable(owner.schema, target.table);
        const targetKey = `${owner.schema}.${target.table}`;
        if (!existingKeys.has(targetKey)) existingKeys.set(targetKey, new Set((await readRows(owner.schema, target.table)).map((value) => JSON.stringify(rowIdentityKeys(value, target.keys)))));
        const seen = existingKeys.get(targetKey)!, key = JSON.stringify(keys);
        if (seen.has(key)) continue;
        const values = Object.entries(declaration.fields).map(([column, path]) => [column, referenceValue(path, match, row)] as const);
        if (values.some(([, value]) => typeof value !== 'string')) throw new Error(`Invalid declaration fields for ${declaration.kind}`);
        await db.execute(sql`INSERT INTO ${table} (${sql.join(values.map(([column]) => sql`${sql.identifier(column)}`), sql`, `)})
          VALUES (${sql.join(values.map(([, value]) => sql`${value as string}`), sql`, `)})`);
        seen.add(key);
      }
    }
  }
}
