import { describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { runMigrations } from './migrations';

const available = await testDatabaseAvailable();

describe.skipIf(!available)('runMigrations', () => {
  test('按 layer 顺序应用、幂等、内容变化即拒绝', async () => {
    const tdb = await createTestDatabase();
    try {
      const sets = [
        { module: 'b', layer: 2, files: [{ name: '0001_b.sql', sql: 'CREATE SCHEMA b; CREATE TABLE b.t (id int);' }] },
        { module: 'a', layer: 1, files: [{ name: '0001_a.sql', sql: 'CREATE SCHEMA a; CREATE TABLE a.t (id int);' }] },
      ];
      expect(await runMigrations(tdb.db, sets)).toEqual(['a/0001_a.sql', 'b/0001_b.sql']);
      expect(await runMigrations(tdb.db, sets)).toEqual([]);
      const rows = await tdb.db.execute(sql`SELECT count(*)::int AS n FROM platform_infra.migrations`);
      expect((rows as unknown as Array<{ n: number }>)[0]?.n).toBe(2);
      const changed = [{ module: 'a', layer: 1, files: [{ name: '0001_a.sql', sql: 'SELECT 2;' }] }];
      await expect(runMigrations(tdb.db, changed)).rejects.toThrow('不可修改');
    } finally {
      await tdb.drop();
    }
  });
});
