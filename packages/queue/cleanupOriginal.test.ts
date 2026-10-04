import { describe, expect, test } from 'bun:test';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { claimOriginalCleanupJob } from './cleanupOriginal';
import { claimJobs, completeJob, enqueueJob, getJobState, heartbeatJob, lockJobLease, queueMigrations } from './jobs';

const available = await testDatabaseAvailable();
const selection = { kind: 'original-cleanup', dedupKey: 'accepted-original-task', payload: { taskId: 'accepted-original-task' } };
describe.skipIf(!available)('original cleanup resumption (actual PostgreSQL)', () => {
  test('resumes the completed original row with a new fence, without exposing a pending job or inserting a replacement', async () => {
    const db = await createTestDatabase([queueMigrations]);
    try {
      const original = await enqueueJob(db.db, selection.kind, selection.payload, { dedupKey: selection.dedupKey });
      const [first] = await claimJobs(db.db, [selection.kind], 'ordinary-owner', 120, 1);
      await completeJob(db.db, first!.id, first!.fencingToken);
      const job = await claimOriginalCleanupJob(db.db, selection, 'deletion-owner', 120);
      expect(job).toMatchObject({ id: original.id, fencingToken: first!.fencingToken + 1, attempts: 2 });
      expect(await claimJobs(db.db, [selection.kind], 'ordinary-worker', 120, 1)).toEqual([]);
      expect(await db.db.execute(sql`SELECT id FROM platform_infra.jobs`)).toHaveLength(1);
      expect(await heartbeatJob(db.db, first!.id, first!.fencingToken, 120)).toBe(false);
      expect(await db.db.transaction((tx) => lockJobLease(tx, job!.id, job!.fencingToken, selection))).toBe(true);
      expect(await completeJob(db.db, job!.id, job!.fencingToken)).toBe(true);
    } finally { await db.drop(); }
  });
  test('concurrent cleanup and takeover keep the same original row and reject the former owner', async () => {
    const db = await createTestDatabase([queueMigrations]);
    try {
      await enqueueJob(db.db, selection.kind, selection.payload, { dedupKey: selection.dedupKey });
      const candidates = await Promise.all([claimOriginalCleanupJob(db.db, selection, 'first', 120), claimOriginalCleanupJob(db.db, selection, 'second', 120)]);
      const claimed = candidates.filter((value) => value !== undefined); expect(claimed).toHaveLength(1);
      const first = claimed[0]!;
      expect(await claimOriginalCleanupJob(db.db, selection, 'busy', 120)).toBeUndefined();
      await db.db.execute(sql`UPDATE platform_infra.jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=${first.id}`);
      const resumed = await claimOriginalCleanupJob(db.db, selection, 'takeover', 120);
      expect(resumed).toMatchObject({ id: first.id, fencingToken: first.fencingToken + 1 });
      expect(await completeJob(db.db, first.id, first.fencingToken)).toBe(false);
      expect(await db.db.transaction((tx) => lockJobLease(tx, resumed!.id, resumed!.fencingToken, selection))).toBe(true);
    } finally { await db.drop(); }
  });
  test('never falls back to an older matching payload when the latest original delivery has conflicting material', async () => {
    const db = await createTestDatabase([queueMigrations]);
    try {
      const old = await enqueueJob(db.db, selection.kind, selection.payload, { dedupKey: selection.dedupKey });
      await db.db.execute(sql`UPDATE platform_infra.jobs SET state='done' WHERE id=${old.id}`);
      const latest = await enqueueJob(db.db, selection.kind, { taskId: 'another-task' }, { dedupKey: selection.dedupKey });
      expect(await claimOriginalCleanupJob(db.db, selection, 'owner', 120)).toBeUndefined();
      expect(await getJobState(db.db, old.id!)).toMatchObject({ state: 'done', attempts: 0 });
      expect(await getJobState(db.db, latest.id!)).toMatchObject({ state: 'pending', attempts: 0 });
    } finally { await db.drop(); }
  });
  test('missing or differently bound originals never produce a new row; terminal retries require a valid lease', async () => {
    const db = await createTestDatabase([queueMigrations]);
    try {
      expect(await claimOriginalCleanupJob(db.db, selection, 'owner', 120)).toBeUndefined();
      const job = await enqueueJob(db.db, selection.kind, selection.payload, { dedupKey: selection.dedupKey });
      await db.db.execute(sql`UPDATE platform_infra.jobs SET state='dead',run_at=clock_timestamp()+interval '1 hour' WHERE id=${job.id}`);
      for (const patch of [{ kind: 'other-kind' }, { dedupKey: 'other-key' }, { payload: { ...selection.payload, extra: true } }])
        expect(await claimOriginalCleanupJob(db.db, { ...selection, ...patch }, 'owner', 120)).toBeUndefined();
      for (const lease of [0, -1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1])
        await expect(claimOriginalCleanupJob(db.db, selection, 'owner', lease)).rejects.toMatchObject({ kind: 'precondition' });
      expect(await claimOriginalCleanupJob(db.db, selection, 'owner', 120)).toMatchObject({ id: job.id });
      expect(await db.db.execute(sql`SELECT id FROM platform_infra.jobs`)).toHaveLength(1);
    } finally { await db.drop(); }
  });
});
