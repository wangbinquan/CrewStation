import { describe, expect, test } from 'bun:test';
import { assertSharedDatabaseAdmissionActive, withSharedDatabaseAdmission } from '@crewstation/persistence';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { runtimeProjectAdmissionKey, runtimeProjectWork } from '../../adapters/persistence/deletion/projectWork';
import { runtimeWorkFixture } from './workFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('asynchronous cross-owner callback lifetime (real PG)', () => {
  test('an issued permission callback retains its original backend after the emitting callback returns', async () => {
    const f = await runtimeWorkFixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    const replied = Promise.withResolvers<void>(), late = Promise.withResolvers<void>();
    const key = 'session.project-admission:' + f.project;
    const work = runtimeProjectWork(f.database.db, { ...f.sources, processes: { ...f.sources.processes,
      protectCurrent: async () => { entered.resolve(); await release.promise; return f.original; },
    } });
    let child: Promise<unknown> | undefined, parent: Promise<unknown> | undefined, lateAuthority: Promise<unknown> | undefined;
    try {
      parent = withSharedDatabaseAdmission(f.database.db, key, async () => {
        // Live WebSocket broadcasts schedule permission checks without awaiting them.
        // Returning the emitter must not release the backend before this birth commits.
        child = work.runResponse(f.input(), async () => 'authorized');
        void child.catch(() => undefined);
        lateAuthority = late.promise.then(() => {
          expect(() => assertSharedDatabaseAdmissionActive(f.database.db, key)).toThrow('has exited');
        });
        await entered.promise; replied.resolve();
      });
      await replied.promise;
      const locks = await f.database.db.transaction(tx => tx.execute<{ available: boolean }>(sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${runtimeProjectAdmissionKey(f.project)},0)) AS available`));
      late.resolve(); await lateAuthority;
      expect(locks[0]!.available).toBe(false);
      release.resolve(); expect(await child).toBe('authorized'); await parent; await work.drain();
      expect(await work.history(f.project)).toMatchObject([{ exited: true }]);
    } finally {
      release.resolve(); late.resolve();
      await Promise.allSettled([parent, child, lateAuthority]); await work.drain(); await f.drop();
    }
  }, 15_000);
});
