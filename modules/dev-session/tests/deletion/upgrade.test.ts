import { describe, expect, test } from 'bun:test';
import { runMigrations } from '@crewstation/persistence';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { DEVELOPMENT_CONTENT } from '../../adapters/persistence/deletion/contentTables';
import { devSessionMigrations } from '../../wiring';
import { developmentContentFixture, seedDevelopmentContent } from './contentFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('development original content upgrade (actual old PG; controlled public identity witnesses)', () => {
  test('appending work and content guards preserves every original row and then inventories all legacy families', async () => {
    const f = await developmentContentFixture({ legacyOnly: true });
    try {
      await seedDevelopmentContent(f);
      const tables = DEVELOPMENT_CONTENT.filter((entry) => entry.table !== 'original_callbacks');
      const fingerprint = async () => {
        const rows: unknown[] = [];
        for (const entry of tables) rows.push(...await f.database.db.execute(sql`SELECT ${entry.table} AS family,
          count(*)::text AS count,encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb)::text,'UTF8')),'hex') AS digest
          FROM ${sql.raw('dev_session.' + entry.table)} r`));
        return rows;
      };
      const before = await fingerprint();
      await runMigrations(f.database.db, [devSessionMigrations]);
      expect(await fingerprint()).toEqual(before);
      const current = await f.inspect(); expect(current.inventory.complete).toBe(true);
      expect(current.inventory.resources).toHaveLength(13); expect(current.contents).toHaveLength(13);
      expect(current.traversal.counts['original_callbacks']).toBe(0);
      expect(await f.database.db.execute('SELECT id FROM dev_session.original_callbacks')).toHaveLength(0);
      expect(await f.database.db.execute('SELECT project_id FROM dev_session.project_admissions')).toHaveLength(0);
      expect(await f.database.db.execute('SELECT kind FROM dev_session.content_origins')).toHaveLength(0);
      expect((await f.database.db.execute(sql`SELECT name FROM platform_infra.migrations WHERE module=${devSessionMigrations.module}`)).length).toBe(devSessionMigrations.files.length);
    } finally { await f.database.drop(); }
  });
});
