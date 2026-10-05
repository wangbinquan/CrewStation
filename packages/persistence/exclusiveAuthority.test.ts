import { describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { connectDatabase } from './connection';
import { withExclusiveDatabaseAdmissionAuthority, withSharedDatabaseAdmission } from './transactionContext';
import type { DatabaseAdmissionAuthority } from './exclusiveAuthority';

const available = await testDatabaseAvailable(), key = 'native.registry-exclusive-fixture';
describe.skipIf(!available)('original native exclusive authority (real PG)', () => {
  test('actual exclusive lock blocks a foreign producer; its original authority expires after the callback', async () => {
    const f = await createTestDatabase(), db = connectDatabase(f.url, { max: 1 });
    let saved!: DatabaseAdmissionAuthority, release!: () => void, ready!: () => void;
    const entered = new Promise<void>(resolve => { ready = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
    try {
      const reclaim = withExclusiveDatabaseAdmissionAuthority(db.db, key, async authority => { saved = authority; expect(await authority.assertActive()).toBe(authority.identity); ready(); await held; return 'reclaimed'; });
      await entered;
      let producerEntered = false;
      const producer = withSharedDatabaseAdmission(db.db, key, async () => { producerEntered = true; return 'producer'; });
      // Read the server's actual pending lock, rather than infer exclusion from elapsed time.
      const deadline = Date.now() + 2000;
      while (!(await f.db.execute<{ waiting: boolean }>(sql`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted) AS waiting`))[0]!.waiting) {
        if (Date.now() >= deadline) throw Error('Actual producer never reached the original lock'); await Bun.sleep(10);
      }
      expect(producerEntered).toBe(false); expect(await saved.assertActive()).toBe(saved.identity);
      release(); expect(await reclaim).toBe('reclaimed'); expect(await producer).toBe('producer');
      await expect(saved.assertActive()).rejects.toThrow('has exited');
    } finally { release?.(); await db.close(); await f.drop(); }
  }, 10_000);

  test('loss of the original backend rejects native mutation even while its original callback and a new connection remain alive', async () => {
    const f = await createTestDatabase(), db = connectDatabase(f.url, { max: 1 });
    let authority!: DatabaseAdmissionAuthority, release!: () => void, entered!: () => void, left!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; }), exited = new Promise<void>(resolve => { left = resolve; });
    try {
      const pending = withExclusiveDatabaseAdmissionAuthority(db.db, key, async original => {
        authority = original; entered(); await held;
        try { await expect(original.assertActive()).rejects.toThrow('has exited'); }
        finally { left(); }
      }).then(() => 'unexpected-success', () => 'disconnected');
      await ready;
      const locks = await f.db.execute<{ pid: number }>(sql`SELECT pid FROM pg_locks WHERE locktype='advisory' AND mode='ExclusiveLock' AND granted`);
      expect(locks).toHaveLength(1);
      await f.db.execute(sql`SELECT pg_terminate_backend(${locks[0]!.pid})`);
      expect(await pending).toBe('disconnected');
      await withExclusiveDatabaseAdmissionAuthority(db.db, key, async replacement => {
        expect(replacement.identity).not.toBe(authority.identity); expect(await replacement.assertActive()).toBe(replacement.identity);
        await expect(authority.assertActive()).rejects.toThrow('has exited');
      });
    } finally { release?.(); await exited; await db.close(); await f.drop(); }
  }, 10_000);
});
