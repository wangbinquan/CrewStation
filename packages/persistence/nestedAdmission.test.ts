import { afterEach, describe, expect, test } from 'bun:test';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { connectDatabase } from './connection';
import type { DatabaseHandle } from './connection';
import { assertSharedDatabaseAdmissionActive, withExclusiveDatabaseAdmission, withSharedDatabaseAdmission } from './transactionContext';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('cross-module admission lifetime (real PG)', () => {
  let database: TestDatabase, handle: DatabaseHandle;
  afterEach(async () => { await handle?.close(); await database?.drop(); }, 15_000);
  test('four concurrent development requests can enter runtime admission without exhausting the four guard connections', async () => {
    database = await createTestDatabase(); handle = connectDatabase(database.url, { max: 1 });
    const entered = Promise.withResolvers<void>(); let count = 0;
    const requests = Array.from({ length: 4 }, (_, index) => withSharedDatabaseAdmission(handle.db, `dev:${index}`, async () => {
      if (++count === 4) entered.resolve();
      await entered.promise;
      return withSharedDatabaseAdmission(handle.db, `runtime:${index}`, async () => {
        await handle.db.transaction(tx => tx.execute(sql`SELECT 1`)); return index;
      });
    }));
    // RFC-041 live acceptance: all four outer guards waited for a fifth connection, producing repeated HTTP 502s.
    const completed = Promise.all(requests).then(values => ({ kind: 'completed', values }), () => ({ kind: 'rejected', values: [] }));
    const result = await Promise.race([completed, Bun.sleep(2000).then(() => ({ kind: 'starved', values: [] }))]);
    expect(result).toEqual({ kind: 'completed', values: [0, 1, 2, 3] });
  }, 15_000);

  test('nested keys keep actual locks until the outer callback exits while authority remains scoped', async () => {
    database = await createTestDatabase(); handle = connectDatabase(database.url, { max: 1 });
    const outer = 'dev:scoped', inner = 'runtime:scoped'; let innerBackend = 0;
    await withSharedDatabaseAdmission(handle.db, outer, async guard => {
      const backend = Number((await guard.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`))[0]!.pid);
      await withSharedDatabaseAdmission(handle.db, inner, async nested => {
        innerBackend = Number((await nested.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`))[0]!.pid);
        expect(innerBackend).toBe(backend);
        for (const key of [outer, inner]) expect(() => assertSharedDatabaseAdmissionActive(handle.db, key)).not.toThrow();
        const rows = await handle.db.transaction(tx => tx.execute<{ keys: string; pid: string }>(sql`SELECT current_setting('crewstation.shared_admission_keys') AS keys,current_setting('crewstation.shared_admission_pid') AS pid`));
        expect(JSON.parse(rows[0]!.keys)).toEqual([outer, inner].sort()); expect(rows[0]!.pid).toBe(String(backend));
      });
      expect(() => assertSharedDatabaseAdmissionActive(handle.db, inner)).toThrow('has exited');
      expect(() => assertSharedDatabaseAdmissionActive(handle.db, outer)).not.toThrow();
      expect(() => withExclusiveDatabaseAdmission(handle.db, inner, async () => undefined)).toThrow('active shared');
      await withSharedDatabaseAdmission(handle.db, inner, async nested => { expect(nested).toBe(guard); });
      const locks = await database.db.transaction(tx => tx.execute<{ available: boolean }>(sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${inner},0)) AS available`));
      expect(locks[0]!.available).toBe(false);
    });
    expect(innerBackend).toBeGreaterThan(0);
    expect(await withExclusiveDatabaseAdmission(handle.db, inner, async () => 'released')).toBe('released');
  }, 10_000);

  test('losing the original backend invalidates nested authority before late work can reuse it', async () => {
    database = await createTestDatabase(); handle = connectDatabase(database.url, { max: 1 });
    const entered = Promise.withResolvers<number>(), release = Promise.withResolvers<void>(), exited = Promise.withResolvers<void>();
    const pending = withSharedDatabaseAdmission(handle.db, 'dev:lost', async () => withSharedDatabaseAdmission(handle.db, 'runtime:lost', async guard => {
      entered.resolve(Number((await guard.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`))[0]!.pid)); await release.promise;
      try {
        for (const key of ['dev:lost', 'runtime:lost']) expect(() => assertSharedDatabaseAdmissionActive(handle.db, key)).toThrow('has exited');
        const rows = await handle.db.transaction(tx => tx.execute<{ key: string | null }>(sql`SELECT current_setting('crewstation.shared_admission_key',true) AS key`));
        expect(rows[0]!.key || undefined).toBeUndefined();
      } finally { exited.resolve(); }
    })).then(() => 'unexpected-success', () => 'disconnected');
    try { await database.db.execute(sql`SELECT pg_terminate_backend(${await entered.promise})`); expect(await pending).toBe('disconnected'); }
    finally { release.resolve(); }
    await exited.promise;
  }, 10_000);
});
