import { sql } from 'drizzle-orm';
import { describe, expect, setSystemTime, test } from 'bun:test';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { claimJobs, completeJob, enqueueJob, failJob, getJobState, lockJobLease, queueMigrations } from './jobs';
import { createWorker } from './worker';

const available = await testDatabaseAvailable();

describe.skipIf(!available)('PostgreSQL 表队列', () => {
  test('入队去重、认领、fencing、失败退避与 dead', async () => {
    const tdb = await createTestDatabase([queueMigrations]);
    try {
      const first = await enqueueJob(tdb.db, 'build', { release: 'r1' }, { dedupKey: 'r1', maxAttempts: 2 });
      const dup = await enqueueJob(tdb.db, 'build', { release: 'r1' }, { dedupKey: 'r1' });
      expect(first.deduplicated).toBe(false);
      expect(dup.deduplicated).toBe(true);
      const [job] = await claimJobs(tdb.db, ['build'], 'w1', 30, 5);
      expect(job?.fencingToken).toBe(1);
      expect(await claimJobs(tdb.db, ['build'], 'w2', 30, 5)).toEqual([]);
      expect(await completeJob(tdb.db, job!.id, 999)).toBe(false);
      expect(await failJob(tdb.db, job!, 'boom')).toBe('retry');
      expect((await getJobState(tdb.db, job!.id))?.state).toBe('pending');
      await tdb.db.execute(`UPDATE platform_infra.jobs SET run_at = now()`);
      const [again] = await claimJobs(tdb.db, ['build'], 'w2', 30, 5);
      expect(again?.fencingToken).toBe(2);
      expect(await failJob(tdb.db, again!, 'boom again')).toBe('dead');
      expect((await getJobState(tdb.db, job!.id))?.state).toBe('dead');
    } finally {
      await tdb.drop();
    }
  });

  test('worker 执行处理器并完成任务', async () => {
    const tdb = await createTestDatabase([queueMigrations]);
    try {
      const seen: unknown[] = [];
      await enqueueJob(tdb.db, 'notify', { n: 1 });
      await enqueueJob(tdb.db, 'notify', { n: 2 });
      const worker = createWorker({ db: tdb.db, kinds: ['notify'], owner: 'test', concurrency: 2, handler: async (job) => { seen.push(job.payload); } });
      expect(await worker.runOnce()).toBe(2);
      expect(seen.map((p) => (p as { n: number }).n).sort()).toEqual([1, 2]);
      expect(await worker.runOnce()).toBe(0);
    } finally {
      await tdb.drop();
    }
  });

  test('立即任务用数据库时间，不因调用进程时钟超前而被当成延时任务', async () => {
    const tdb = await createTestDatabase([queueMigrations]);
    try {
      const future = new Date(Date.now() + 60_000);
      try {
        setSystemTime(future);
        await enqueueJob(tdb.db, 'clock', { immediate: true });
        await enqueueJob(tdb.db, 'clock', { immediate: false }, { runAt: future });
      } finally { setSystemTime(); }
      const claimed = await claimJobs(tdb.db, ['clock'], 'clock-test', 30, 5);
      expect(claimed.map((job) => job.payload)).toEqual([{ immediate: true }]);
    } finally { await tdb.drop(); }
  });
});

describe.skipIf(!available)('RFC-034 atomic original execution lease', () => {
  test('the transaction fences live identity, payload and kind; an old token cannot commit after takeover', async () => {
    const tdb = await createTestDatabase([queueMigrations]);
    try {
      await enqueueJob(tdb.db, 'native', { taskId: 'original' });
      const [job] = await claimJobs(tdb.db, ['native'], 'original-owner', 30, 1);
      const expected = { kind: 'native', payload: { taskId: 'original' } };
      expect(await tdb.db.transaction((tx) => lockJobLease(tx, job!.id, job!.fencingToken, expected))).toBe(true);
      for (const other of [{ kind: 'other', payload: expected.payload }, { ...expected, payload: { taskId: 'replacement' } }]) {
        expect(await tdb.db.transaction((tx) => lockJobLease(tx, job!.id, job!.fencingToken, other))).toBe(false);
      }
      expect(await tdb.db.transaction((tx) => lockJobLease(tx, job!.id, 0, expected))).toBe(false);
      await tdb.db.execute(sql`UPDATE platform_infra.jobs SET lease_until = clock_timestamp() - interval '1 second' WHERE id = ${job!.id}`);
      const [newOwner] = await claimJobs(tdb.db, ['native'], 'replacement-owner', 30, 1);
      expect(newOwner!.fencingToken).toBe(job!.fencingToken + 1);
      expect(await tdb.db.transaction((tx) => lockJobLease(tx, job!.id, job!.fencingToken, expected))).toBe(false);
      expect(await tdb.db.transaction((tx) => lockJobLease(tx, job!.id, newOwner!.fencingToken, expected))).toBe(true);
      await completeJob(tdb.db, job!.id, newOwner!.fencingToken);
      expect(await tdb.db.transaction((tx) => lockJobLease(tx, job!.id, newOwner!.fencingToken, expected))).toBe(false);
      expect(await tdb.db.transaction((tx) => lockJobLease(tx, job!.id + 100, newOwner!.fencingToken, expected))).toBe(false);
    } finally { await tdb.drop(); }
  });
  test('lease expiry while waiting for the job row is measured after the actual PostgreSQL lock', async () => {
    const tdb = await createTestDatabase([queueMigrations]);
    let release!: () => void, locked!: () => void;
    const ready = new Promise<void>((resolve) => { locked = resolve; }), unblock = new Promise<void>((resolve) => { release = resolve; });
    let holder: Promise<unknown> | undefined, checking: Promise<boolean> | undefined;
    try {
      await enqueueJob(tdb.db, 'native', { taskId: 'original' });
      const [job] = await claimJobs(tdb.db, ['native'], 'owner', 30, 1);
      holder = tdb.db.transaction(async (tx) => {
        await tx.execute(sql`SELECT id FROM platform_infra.jobs WHERE id = ${job!.id} FOR UPDATE`);
        locked(); await unblock;
        await tx.execute(sql`UPDATE platform_infra.jobs SET lease_until = clock_timestamp() - interval '1 second' WHERE id = ${job!.id}`);
      });
      await ready;
      checking = tdb.db.transaction((tx) => lockJobLease(tx, job!.id, job!.fencingToken, { kind: 'native', payload: { taskId: 'original' } }));
      const deadline = Date.now() + 2_000;
      let waiting = false;
      while (Date.now() < deadline) {
        const rows = await tdb.db.execute(sql`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%platform_infra.jobs%'`) as unknown as Array<{ n: number }>;
        if (rows[0]!.n > 0) { waiting = true; break; }
        await Bun.sleep(5);
      }
      expect(waiting).toBe(true);
      release(); await holder;
      expect(await checking).toBe(false);
    } finally { release?.(); await Promise.allSettled([holder, checking]); await tdb.drop(); }
  });
});
