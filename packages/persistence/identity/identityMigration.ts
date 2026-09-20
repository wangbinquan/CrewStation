import { sql } from 'drizzle-orm';
import type { IdentityAlias, IdentityExecutor, ResourceIdentityMigration } from './model';
import { identityKey, ResourceIdentityMap } from './identityMap';
import { identityValues, matchesIdentityCondition, referenceKeys } from './documentTransform';
import { importIdentityDeclarations } from './identityDeclarations';
import { qualifiedTable, readIdentityJson, readIdentityRows, rewriteIdentityTables, rowIdentityKeys } from './databaseRewrite';

const ALIASES = 'resource_identity_aliases';

async function prepareAliasStore(db: IdentityExecutor, schema: string): Promise<IdentityAlias[]> {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS ${qualifiedTable(schema, ALIASES)} (
    kind text NOT NULL, key text NOT NULL, id text NOT NULL, PRIMARY KEY (kind, key))`);
  return await db.execute(sql`SELECT kind, key, id FROM ${qualifiedTable(schema, ALIASES)}`) as unknown as IdentityAlias[];
}

async function storeAliases(db: IdentityExecutor, schema: string, aliases: readonly IdentityAlias[]): Promise<void> {
  const unique = [...new Map(aliases.map((alias) => [JSON.stringify([alias.kind, alias.key]), alias])).values()];
  for (let start = 0; start < unique.length; start += 500) {
    const values = unique.slice(start, start + 500).map((alias) => sql`(${alias.kind}, ${alias.key}, ${alias.id})`);
    await db.execute(sql`INSERT INTO ${qualifiedTable(schema, ALIASES)} (kind, key, id) VALUES ${sql.join(values, sql`, `)} ON CONFLICT (kind, key) DO NOTHING`);
  }
}

async function prepareIdentities(db: IdentityExecutor, definition: ResourceIdentityMigration, identities: ResourceIdentityMap): Promise<void> {
  const owned: IdentityAlias[] = [];
  const tables = new Map<string, Promise<Record<string, unknown>[]>>();
  const rows = (table: string) => {
    if (!tables.has(table)) tables.set(table, readIdentityRows(db, definition.schema, table));
    return tables.get(table)!;
  };
  for (const seed of definition.seeds ?? []) {
    const alias = { kind: seed.kind, key: identityKey(seed.keys), id: seed.id };
    identities.add(alias); owned.push(alias);
  }
  for (const entity of definition.entities) {
    for (const row of await rows(entity.table)) {
      if (!matchesIdentityCondition(row, entity.where)) continue;
      if (entity.nullable && entity.keys.some((key) => row[key] === null || row[key] === undefined)) continue;
      const currentId = row[entity.idColumn];
      const primary = identities.allocate(entity.kind, rowIdentityKeys(row, entity.keys), typeof currentId === 'string' ? currentId : undefined);
      owned.push(primary);
      for (const keys of entity.aliases ?? []) {
        const alias = { kind: entity.kind, key: identityKey(rowIdentityKeys(row, keys)), id: primary.id };
        identities.add(alias); owned.push(alias);
      }
    }
  }
  for (const entity of definition.inlineEntities ?? []) {
    for (const row of await rows(entity.table)) {
      if (!matchesIdentityCondition(row, entity.where)) continue;
      if (row[entity.column] === null || row[entity.column] === undefined) continue;
      for (const match of identityValues(readIdentityJson(row[entity.column]), entity.path)) {
        if (entity.nullable && (match.value === null || match.value === undefined)) continue;
        owned.push(identities.allocate(entity.kind, referenceKeys(entity, match, row), typeof match.value === 'string' ? match.value : undefined));
      }
    }
  }
  await storeAliases(db, definition.schema, owned);
}

/** Caller owns the transaction and migration lock: all mappings precede all reference rewrites. */
export async function runResourceIdentityMigrations(db: IdentityExecutor, pending: readonly ResourceIdentityMigration[], all: readonly ResourceIdentityMigration[] = pending): Promise<number> {
  if (!pending.length) return 0;
  const identities = new ResourceIdentityMap();
  for (const schema of new Set(all.map((entry) => entry.schema))) {
    for (const alias of await prepareAliasStore(db, schema)) identities.add(alias);
  }
  await importIdentityDeclarations(db, pending);
  for (const definition of pending) await prepareIdentities(db, definition, identities);
  for (const definition of pending) {
    const aliases: IdentityAlias[] = [];
    for (const binding of definition.bindings ?? []) for (const row of await readIdentityRows(db, definition.schema, binding.table)) {
      const alias = { kind: binding.kind, key: identityKey(rowIdentityKeys(row, binding.keys)), id: identities.resolve(binding.kind, rowIdentityKeys(row, binding.referenceKeys)) };
      identities.add(alias); aliases.push(alias);
    }
    await storeAliases(db, definition.schema, aliases);
  }
  let updated = 0;
  for (const definition of pending) updated += await rewriteIdentityTables(db, definition, identities);
  for (const definition of pending) for (const statement of definition.finalize ?? []) await db.execute(sql.raw(statement));
  return updated;
}
