import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import type { TaskId } from '@crewstation/contracts';
import { developmentAgentUsage } from '../adapters/persistence/developmentUsageTable';
import { advanceDevelopmentEnding } from '../application/development/ending';
import { devSessionMigrations } from '../wiring';
import { developmentEndingFixture } from './developmentEndingFixture';

const available = await testDatabaseAvailable();
let database: TestDatabase;
beforeAll(async () => { if (available) database = await createTestDatabase([devSessionMigrations]); });
afterAll(async () => { await database?.drop(); });

async function holdOriginalOwner(id: TaskId) {
  const ready = Promise.withResolvers<void>(), unlocked = Promise.withResolvers<void>();
  const done = database.db.transaction(async (tx) => {
    await tx.select().from(developmentAgentUsage).where(eq(developmentAgentUsage.executionTaskId, id)).for('update');
    ready.resolve(); await unlocked.promise;
  });
  await ready.promise;
  return { release: () => unlocked.resolve(), done };
}
describe.skipIf(!available)('结束租约必须包含真实数据库取锁等待', () => {
  test('evidence observed before deadline cannot commit after waiting for the owner lock past expiration', async () => {
    const f = await developmentEndingFixture(database.db); await f.request();
    let held: Awaited<ReturnType<typeof holdOriginalOwner>> | undefined;
    const committing = Promise.withResolvers<string>();
    f.endingControl.onStop = async () => { held = await holdOriginalOwner(f.child.id); f.endingControl.now = '2026-09-30T00:20:29.000Z'; };
    const operation = advanceDevelopmentEnding({ ...f.deps, store: { ...f.store, commit: (lease, evidence) => {
      committing.resolve(evidence.observedAt); return f.store.commit(lease, evidence);
    } } }, f.child.id);
    try {
      expect(await committing.promise).toBe('2026-09-30T00:20:29.000Z');
      f.endingControl.now = '2026-09-30T00:20:31.000Z'; held!.release();
      // Previously commit captured 29s before row locking and accepted this expired lease.
      expect(await operation).toEqual({ kind: 'waiting', reason: 'stale-lease' });
      expect(await f.store.get(f.child.id)).toMatchObject({ stage: 'awaiting-stop', stop: null, closure: null });
    } finally { held?.release(); await held?.done; }
  });
  test('a retry admitted before expiration cannot release an expired lease after lock contention', async () => {
    const f = await developmentEndingFixture(database.db); await f.request(); const lease = (await f.store.claim(f.child.id, f.endingControl.now))!;
    const held = await holdOriginalOwner(f.child.id);
    try {
      f.endingControl.now = '2026-09-30T00:20:29.000Z'; const retry = f.store.retry(lease, f.endingControl.now);
      f.endingControl.now = '2026-09-30T00:20:31.000Z'; held.release();
      expect(await retry).toBe(false); expect((await f.store.get(f.child.id))!.fence).toBe(lease.job.fence);
    } finally { held.release(); await held.done; }
  });
  test('a claim waiting on owner rows can acquire the now-expired lease with a fresh full deadline', async () => {
    const f = await developmentEndingFixture(database.db); await f.request(); const original = (await f.store.claim(f.child.id, f.endingControl.now))!;
    const held = await holdOriginalOwner(f.child.id);
    try {
      f.endingControl.now = '2026-09-30T00:20:29.000Z'; const claim = f.store.claim(f.child.id, f.endingControl.now);
      f.endingControl.now = '2026-09-30T00:20:31.000Z'; held.release();
      const next = (await claim)!;
      expect(next).toBeDefined(); expect(next.job.fence).toBe(original.job.fence + 1); expect(next.job.leaseUntil).toBe('2026-09-30T00:21:01.000Z');
    } finally { held.release(); await held.done; }
  });
});
