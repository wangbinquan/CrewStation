import { describe, expect, test } from 'bun:test';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { claimJobs, completeJob, enqueueJob, failJob, getJobState, queueMigrations } from './jobs';
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
});
