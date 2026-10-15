import { describe, expect, test } from 'bun:test';
import { runMigrations } from '@crewstation/persistence';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { DEVELOPMENT_CONTENT } from '../../adapters/persistence/deletion/contentTables';
import { devSessionMigrations } from '../../wiring';
import { developmentContentFixture, seedDevelopmentContent } from './contentFixture';

const available = await testDatabaseAvailable();
/** RFC-034 v2（0022 断代）有意退役的旧列；其余旧列的每一行在升级后逐字保留。 */
const RETIRED_BY_V2: Record<string, string[]> = { agent_starts: ['logical_ending'] };
const kept = (table: string, columns: readonly string[]) => columns.filter((column) => !(RETIRED_BY_V2[table] ?? []).includes(column));
describe.skipIf(!available)('development original content upgrade (actual old PG; controlled public identity witnesses)', () => {
  test('appending work and content guards preserves every original row and then inventories all legacy families', async () => {
    const f = await developmentContentFixture({ legacyOnly: true });
    try {
      await seedDevelopmentContent(f);
      const tables = DEVELOPMENT_CONTENT.filter((entry) => entry.table !== 'original_callbacks');
      const oldColumns = new Map<string, string[]>();
      for (const entry of tables) {
        const columns = await f.database.db.execute<{column_name: string}>(sql`SELECT column_name FROM information_schema.columns WHERE table_schema='dev_session' AND table_name=${entry.table} ORDER BY ordinal_position`);
        oldColumns.set(entry.table, columns.map(column => column.column_name));
      }
      const fingerprint = async () => {
        const rows: unknown[] = [];
        for (const entry of tables) rows.push(...await f.database.db.execute(sql`SELECT ${entry.table} AS family,
          count(*)::text AS count,encode(sha256(convert_to(coalesce(jsonb_agg(original.document ORDER BY original.document::text),'[]'::jsonb)::text,'UTF8')),'hex') AS digest
          FROM ${sql.raw('dev_session.' + entry.table)} r
          CROSS JOIN LATERAL (SELECT jsonb_object_agg(item.key,item.value) AS document FROM jsonb_each(to_jsonb(r)) item WHERE item.key IN ${kept(entry.table, oldColumns.get(entry.table)!)}) original`));
        return rows;
      };
      const before = await fingerprint();
      await runMigrations(f.database.db, [devSessionMigrations]);
      expect(await fingerprint()).toEqual(before);
      const retired: Record<string, string[]> = {};
      for (const entry of tables) {
        const columns = new Set((await f.database.db.execute<{column_name: string}>(sql`SELECT column_name FROM information_schema.columns WHERE table_schema='dev_session' AND table_name=${entry.table}`)).map((column) => column.column_name));
        const gone = oldColumns.get(entry.table)!.filter((column) => !columns.has(column));
        if (gone.length) retired[entry.table] = gone;
      }
      expect(retired).toEqual(RETIRED_BY_V2);
      const current = await f.inspect(); expect(current.inventory.complete).toBe(true);
      expect(current.inventory.resources).toHaveLength(11); expect(current.contents).toHaveLength(11);
      expect(current.traversal.counts['original_callbacks']).toBe(0);
      expect(await f.database.db.execute('SELECT id FROM dev_session.original_callbacks')).toHaveLength(0);
      expect(await f.database.db.execute('SELECT project_id FROM dev_session.project_admissions')).toHaveLength(0);
      expect(await f.database.db.execute('SELECT kind FROM dev_session.content_origins')).toHaveLength(0);
      expect((await f.database.db.execute(sql`SELECT name FROM platform_infra.migrations WHERE module=${devSessionMigrations.module}`)).length).toBe(devSessionMigrations.files.length);
    } finally { await f.database.drop(); }
  });
});
