// Actual job leases and actual changes_stamp waits: expiry without takeover must roll back all five owners.
import { afterEach, describe, expect, test } from 'bun:test';
import { DomainTopic } from '@crewstation/contracts';
import { claimJobs, completeJob, queueMigrations } from '@crewstation/queue';
import { eventbusMigrations } from '@crewstation/eventbus';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { DEVELOPMENT_PARENT_ENDING_JOB_KIND } from '../ports/developmentParentEnding';
import { taskRuntimeMigrations } from '../wiring';
import { drizzleUnitOfWork } from '../adapters/persistence/drizzleUnitOfWork';
import { developmentParentEndingLeaseFixture, endingCheckpoint, waitForParentSqlLock } from './developmentParentEndingLeaseFixture';
import type { DevelopmentParentEndingLeaseFixture } from './developmentParentEndingLeaseFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('parent ending final transaction queue deadline (real PG)', () => {
  let f: DevelopmentParentEndingLeaseFixture;
  afterEach(async () => { await f?.close(); });
  for (const mode of ['ending', 'rebuild'] as const) {
    test(mode + ': a real deferred stamp wait outlives the holder; no takeover is needed to reject every final write', async () => {
      f = await developmentParentEndingLeaseFixture(mode, 3); const before = await f.snapshot(), held = endingCheckpoint(), release = endingCheckpoint(), written = endingCheckpoint();
      const holder = f.db.transaction(async (tx) => { await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('resources.change_seq'))`); held.resolve(); await release.promise; });
      let commit: Promise<void> | undefined;
      try {
        await held.promise;
        commit = f.uow.run(async (scope) => { await scope.admissions.lock(f.projectId); await f.authorize(scope); await f.write(scope); written.resolve(); });
        const outcome = commit.then(() => null, (error: unknown) => error); await Promise.race([written.promise, commit]);
        await waitForParentSqlLock(f.db, 'SET CONSTRAINTS', 'advisory');
        await f.db.execute(sql`SELECT pg_sleep_until(lease_until + interval '30 milliseconds') FROM platform_infra.jobs WHERE id=${f.job.id}`);
        release.resolve(); await holder;
        expect(await outcome).toMatchObject({ message: '父结束或恢复作业租约已失效' });
        expect(await f.snapshot()).toEqual(before);
        const [job] = await f.db.execute(sql`SELECT fencing_token,state FROM platform_infra.jobs WHERE id=${f.job.id}`);
        expect(Number(job!.fencing_token)).toBe(f.job.fencingToken); expect(job!.state).toBe('running');
      } finally { release.resolve(); await Promise.allSettled([holder, commit]); }
    }, 15000);
    test(mode + ': release inside the deadline commits the original Task/ending/claim/projection/event once', async () => {
      f = await developmentParentEndingLeaseFixture(mode); const before = await f.snapshot(), held = endingCheckpoint(), release = endingCheckpoint(), written = endingCheckpoint();
      const holder = f.db.transaction(async (tx) => { await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('resources.change_seq'))`); held.resolve(); await release.promise; });
      let commit: Promise<void> | undefined;
      try {
        await held.promise;
        commit = f.uow.run(async (scope) => { await scope.admissions.lock(f.projectId); await f.authorize(scope); await f.write(scope); written.resolve(); });
        await Promise.race([written.promise, commit]); await waitForParentSqlLock(f.db, 'SET CONSTRAINTS', 'advisory');
        release.resolve(); await holder; await commit;
        const after = await f.snapshot(); expect(after.parent?.message).toBe('signed storage transaction');
        expect(after.ending?.phase).toBe('children'); expect(after.claim?.revision).toBe(1);
        expect(after.resource!.version).toBeGreaterThan(before.resource!.version); expect(after.events).toBe(before.events + 1);
      } finally { release.resolve(); await Promise.allSettled([holder, commit]); }
    }, 15000);
    test(mode + ': takeover during the Project lock wait rejects the old token and accepts the original operation with the fresh token', async () => {
      f = await developmentParentEndingLeaseFixture(mode); const before = await f.snapshot(), held = endingCheckpoint(), release = endingCheckpoint();
      const holder = f.uow.run(async (scope) => { await scope.admissions.lock(f.projectId); held.resolve(); await release.promise; });
      let commit: Promise<void> | undefined;
      try {
        await held.promise; commit = f.uow.run(async (scope) => { await scope.admissions.lock(f.projectId); await f.authorize(scope); await f.write(scope); });
        const outcome = commit.then(() => null, (error: unknown) => error);
        await waitForParentSqlLock(f.db, 'task_runtime', 'transactionid');
        await f.db.execute(sql`UPDATE platform_infra.jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=${f.job.id}`);
        const [next] = await claimJobs(f.db, [f.kind], 'replacement-parent-worker', 120, 1); expect(next!.fencingToken).toBe(f.job.fencingToken + 1);
        release.resolve(); await holder; expect(await outcome).toMatchObject({ message: '父结束或恢复作业租约已失效' });
        expect(await f.snapshot()).toEqual(before);
        await f.uow.run(async (scope) => { await scope.admissions.lock(f.projectId); await f.authorize(scope, next!); await f.write(scope); });
        expect((await f.snapshot()).events).toBe(before.events + 1);
      } finally { release.resolve(); await Promise.allSettled([holder, commit]); }
    }, 15000);
  }
  test('a bound lease rejects outside run, the wrong kind, the wrong original payload and stale token', async () => {
    f = await developmentParentEndingLeaseFixture('ending'); const before = await f.snapshot();
    await expect(f.authorize(f.uow.read)).rejects.toThrow('只能在提交事务');
    await expect(f.uow.run((s) => s.parentEnding!.rebuildLease.requireCurrent({ jobId: f.job.id, fencingToken: f.job.fencingToken }, f.reference))).rejects.toThrow('租约已失效');
    await expect(f.uow.run((s) => s.parentEnding!.lease.requireCurrent({ jobId: f.job.id, fencingToken: f.job.fencingToken }, Bun.randomUUIDv7()))).rejects.toThrow('租约已失效');
    await expect(f.uow.run((s) => f.authorize(s, { ...f.job, fencingToken: f.job.fencingToken + 1 }))).rejects.toThrow('租约已失效');
    expect(await f.snapshot()).toEqual(before);
  });
  test('missing or failing projection commit boundary rolls back the staged SQL rather than omitting the final check', async () => {
    f = await developmentParentEndingLeaseFixture('ending'); const before = await f.snapshot();
    for (const missing of [true, false]) {
      const uow = drizzleUnitOfWork(f.db, { ledger: { ...f.ledger, within: (tx) => {
        const { flushDeferredChanges: _flush, ...writer } = f.ledger.within(tx as object);
        return missing ? writer : { ...writer, flushDeferredChanges: async () => { throw new Error('projection flush failed'); } };
      } } });
      await expect(uow.run(async (s) => { await s.admissions.lock(f.projectId); await f.authorize(s); await f.write(s); })).rejects.toThrow(missing ? '提交边界尚未装配' : 'projection flush failed');
      expect(await f.snapshot()).toEqual(before);
    }
  });
  test('selected parent projection failure rolls back earlier ending, claim and event writes, including malformed presence', async () => {
    f = await developmentParentEndingLeaseFixture('ending'); const before = await f.snapshot();
    const ledger = { ...f.ledger, within: (tx: object) => ({ ...f.ledger.within(tx), declare: async () => { throw new Error('original parent projection failed'); } }) };
    const uow = drizzleUnitOfWork(f.db, { ledger });
    const valid = { version: 1, endingId: f.ending.id, epochHash: f.ending.epochHash, phase: 'children' } as const;
    for (const pointer of [valid, null, undefined, {}, 'invalid-original']) {
      await expect(uow.run(async (s) => {
        await s.admissions.lock(f.projectId); await f.authorize(s);
        await s.parentEnding!.endings.progress(f.ending.id, 'admission-sealed', { phase: 'children', status: 'pending', afterChildId: null,
          progress: { storageOnly: true }, completionWitness: null, message: null, retryAt: new Date() }, new Date());
        await s.parentEnding!.claims.insert(f.claim(f.ending.id));
        const parent = (await s.environments.getForUpdate(f.parent.id))!;
        await s.events.publish(DomainTopic.taskReleased, { occurredAt: new Date().toISOString(), traceId: parent.traceId,
          projectId: f.projectId, taskId: parent.id, kind: parent.kind, reason: 'user' });
        await s.environments.update({ ...parent, message: 'must roll back', parentEnding: pointer });
      })).rejects.toThrow(pointer === valid ? 'original parent projection failed' : '原开发父任务结束身份无效');
      expect(await f.snapshot()).toEqual(before);
    }
  });
  test('an unselected legacy parent retains the existing projection savepoint compatibility', async () => {
    f = await developmentParentEndingLeaseFixture('ending'); const before = await f.snapshot();
    const ledger = { ...f.ledger, within: (tx: object) => ({ ...f.ledger.within(tx), declare: async () => { throw new Error('legacy projection failed'); } }) };
    const uow = drizzleUnitOfWork(f.db, { ledger });
    await uow.run(async (s) => {
      await s.admissions.lock(f.projectId);
      const parent = (await s.environments.getForUpdate(f.parent.id))!;
      expect(Object.prototype.hasOwnProperty.call(parent, 'parentEnding')).toBe(false);
      await s.environments.update({ ...parent, message: 'legacy saved without projection' });
    });
    const after = await f.snapshot();
    expect(after.parent?.message).toBe('legacy saved without projection');
    expect(after.resource).toEqual(before.resource); expect(after.ending).toEqual(before.ending);
    expect(after.claim).toEqual(before.claim); expect(after.events).toBe(before.events);
  });
  test('a Task transaction without Resources schema still checks its actual lease; dedup and lost ACK recovery reuse the original ending', async () => {
    const tdb = await createTestDatabase([eventbusMigrations, queueMigrations, taskRuntimeMigrations]);
    try {
      const uow = drizzleUnitOfWork(tdb.db), endingId = Bun.randomUUIDv7();
      await uow.run(async (s) => { await s.parentEnding!.queue.enqueue(endingId); await s.parentEnding!.queue.enqueue(endingId); });
      const jobs = await claimJobs(tdb.db, [DEVELOPMENT_PARENT_ENDING_JOB_KIND], 'standalone-ending', 120, 2); expect(jobs).toHaveLength(1); const job = jobs[0];
      expect(await uow.run(async (s) => { await s.parentEnding!.lease.requireCurrent({ jobId: job!.id, fencingToken: job!.fencingToken }, endingId); return 42; })).toBe(42);
      await completeJob(tdb.db, job!.id, job!.fencingToken);
      await uow.run((s) => s.parentEnding!.queue.enqueue(endingId));
      const [recovery] = await claimJobs(tdb.db, [DEVELOPMENT_PARENT_ENDING_JOB_KIND], 'lost-ack-recovery', 120, 2);
      expect(recovery?.id).not.toBe(job!.id); expect(recovery?.payload).toEqual({ endingId });
    } finally { await tdb.drop(); }
  });
});
