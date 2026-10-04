import { describe, expect, test } from 'bun:test';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { claimOriginalJob } from './claimOriginal';
import { completeJob, enqueueJob, getJobState, lockJobLease, queueMigrations } from './jobs';

const available = await testDatabaseAvailable();
const selection = { kind: 'original-cleanup', dedupKey: 'original-task', payload: { taskId: 'original-task' } };

describe.skipIf(!available)('exact original queue delivery (actual PostgreSQL)', () => {
  test('claims the requested durable identity without touching an older delivery from another project', async () => {
    const db = await createTestDatabase([queueMigrations]);
    try {
      const other = await enqueueJob(db.db, selection.kind, { taskId: 'other-project' }, { dedupKey: 'other-project' });
      const original = await enqueueJob(db.db, selection.kind, selection.payload, { dedupKey: selection.dedupKey });
      const job = await claimOriginalJob(db.db, selection, 'deletion-owner', 120);
      expect(job).toMatchObject({ id: original.id, kind: selection.kind, payload: selection.payload, attempts: 1, fencingToken: 1 });
      expect(await getJobState(db.db, other.id!)).toMatchObject({ state: 'pending', attempts: 0 });
      expect(await db.db.transaction((tx) => lockJobLease(tx, job!.id, job!.fencingToken, selection))).toBe(true);
      expect(await completeJob(db.db, job!.id, job!.fencingToken)).toBe(true);
      expect(await claimOriginalJob(db.db, selection, 'late-owner', 120)).toBeUndefined();
    } finally { await db.drop(); }
  });

  test('kind, deduplication key and complete original payload must all match', async () => {
    const db = await createTestDatabase([queueMigrations]);
    try {
      const original = await enqueueJob(db.db, selection.kind, selection.payload, { dedupKey: selection.dedupKey });
      for (const patch of [{ kind: 'other-kind' }, { dedupKey: 'other-key' }, { payload: { taskId: 'replacement' } },
        { payload: { ...selection.payload, extra: true } }])
        expect(await claimOriginalJob(db.db, { ...selection, ...patch }, 'owner', 120)).toBeUndefined();
      expect(await getJobState(db.db, original.id!)).toMatchObject({ state: 'pending', attempts: 0 });
      expect(await claimOriginalJob(db.db, selection, 'owner', 120)).toBeDefined();
    } finally { await db.drop(); }
  });

  test('concurrent resumes claim once; takeover retains the same row and invalidates its old fence', async () => {
    const db = await createTestDatabase([queueMigrations]);
    try {
      await enqueueJob(db.db, selection.kind, selection.payload, { dedupKey: selection.dedupKey });
      const attempts = await Promise.all([claimOriginalJob(db.db, selection, 'first', 120), claimOriginalJob(db.db, selection, 'second', 120)]);
      const claimed = attempts.filter((job) => job !== undefined);
      expect(claimed).toHaveLength(1);
      const original = claimed[0]!;
      expect(await claimOriginalJob(db.db, selection, 'busy', 120)).toBeUndefined();
      await db.db.execute(sql`UPDATE platform_infra.jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=${original.id}`);
      const resumed = await claimOriginalJob(db.db, selection, 'replacement-owner', 120);
      expect(resumed).toMatchObject({ id: original.id, attempts: 2, fencingToken: original.fencingToken + 1 });
      expect(await completeJob(db.db, original.id, original.fencingToken)).toBe(false);
      expect(await db.db.transaction((tx) => lockJobLease(tx, resumed!.id, resumed!.fencingToken, selection))).toBe(true);
    } finally { await db.drop(); }
  });

  test('a delayed or dead delivery is not accelerated or revived', async () => {
    const db = await createTestDatabase([queueMigrations]);
    try {
      const original = await enqueueJob(db.db, selection.kind, selection.payload, { dedupKey: selection.dedupKey, runAt: new Date(Date.now() + 60_000) });
      expect(await claimOriginalJob(db.db, selection, 'owner', 120)).toBeUndefined();
      await db.db.execute(sql`UPDATE platform_infra.jobs SET state='dead',run_at=clock_timestamp() WHERE id=${original.id}`);
      expect(await claimOriginalJob(db.db, selection, 'owner', 120)).toBeUndefined();
      expect(await getJobState(db.db, original.id!)).toMatchObject({ state: 'dead', attempts: 0 });
    } finally { await db.drop(); }
  });

  test('invalid lease and incomplete selections do not execute a claim', async () => {
    const db = await createTestDatabase([queueMigrations]);
    try {
      for (const seconds of [0, -1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1])
        await expect(claimOriginalJob(db.db, selection, 'owner', seconds)).rejects.toMatchObject({ kind: 'precondition' });
      for (const patch of [{ kind: '' }, { dedupKey: '' }])
        await expect(claimOriginalJob(db.db, { ...selection, ...patch }, 'owner', 120)).rejects.toMatchObject({ kind: 'precondition' });
      await expect(claimOriginalJob(db.db, selection, '', 120)).rejects.toMatchObject({ kind: 'precondition' });
    } finally { await db.drop(); }
  });
});
