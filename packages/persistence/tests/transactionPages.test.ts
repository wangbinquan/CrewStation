import { describe, expect, test } from 'bun:test';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { readTransactionPages } from '../transactionPages';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('transaction page reads (actual PostgreSQL)', () => {
  test('reads all pages in the original snapshot, supports nested reads and releases every cursor', async () => {
    const database = await createTestDatabase();
    try {
      await database.db.execute(sql`CREATE TABLE inventory_test(id integer PRIMARY KEY)`);
      await database.db.execute(sql`INSERT INTO inventory_test SELECT generate_series(1, 601)`);
      await database.db.transaction(async (tx) => {
        const values: number[] = [], lengths: number[] = [];
        await readTransactionPages<{ id: number }>(tx, sql`SELECT id FROM inventory_test ORDER BY id`, async (rows) => {
          lengths.push(rows.length); values.push(...rows.map((row) => row.id));
          if (values.length === 200) {
            await database.db.execute(sql`INSERT INTO inventory_test VALUES(602)`);
            let nestedRows = 0;
            await readTransactionPages<{ id: number }>(tx, sql`SELECT id FROM inventory_test ORDER BY id`, async (nested) => {
              nestedRows += nested.length;
              expect(await tx.execute(sql`SELECT name FROM pg_cursors WHERE name LIKE 'cs_read_%'`)).toHaveLength(2);
            });
            expect(nestedRows).toBe(601);
          }
        });
        expect(lengths).toEqual([200, 200, 200, 1]);
        expect(values).toEqual(Array.from({ length: 601 }, (_, index) => index + 1));
        expect(await tx.execute(sql`SELECT name FROM pg_cursors WHERE name LIKE 'cs_read_%'`)).toHaveLength(0);
        let emptyPages = 0;
        await readTransactionPages(tx, sql`SELECT id FROM inventory_test WHERE false`, async () => { emptyPages++; });
        expect(emptyPages).toBe(0);
        const small: number[] = [];
        await readTransactionPages<{ id: number }>(tx, sql`SELECT id FROM inventory_test WHERE id <= 200 ORDER BY id`, async (rows) => {
          small.push(...rows.map((row) => row.id));
          expect(await tx.execute(sql`SELECT name FROM pg_cursors WHERE name LIKE 'cs_read_%'`)).toHaveLength(0);
        });
        expect(small).toEqual(Array.from({ length: 200 }, (_, index) => index + 1));
      }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
    } finally { await database.drop(); }
  });

  test('propagates failed ownership checks and SQL errors without leaving a cursor or masking the cause', async () => {
    const database = await createTestDatabase();
    try {
      await database.db.transaction(async (tx) => {
        const failure = new Error('foreign ownership conflict');
        await expect(readTransactionPages(tx, sql`SELECT generate_series(1, 401) AS id`, async () => { throw failure; })).rejects.toBe(failure);
        expect(await tx.execute(sql`SELECT name FROM pg_cursors WHERE name LIKE 'cs_read_%'`)).toHaveLength(0);
        expect([...await tx.execute(sql`SELECT 1 AS value`)]).toEqual([{ value: 1 }]);
      });
      await expect(database.db.transaction((tx) => readTransactionPages(tx, sql`SELECT generate_series(1, 601) AS id`, async () => {
        await tx.execute(sql`SELECT 1 / 0 AS value`);
      }))).rejects.toMatchObject({ cause: { code: '22012' } });
    } finally { await database.drop(); }
  });
});
