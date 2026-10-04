import { describe, expect, test } from 'bun:test';
import { claimJobs, enqueueJob, queueMigrations } from '@crewstation/queue';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { runtimeOriginalJobs } from '../../adapters/persistence/deletion/originalJobs';
import { NATIVE_EXECUTION_JOB_KIND } from '../../ports/repositories';
import { runtimeWorkFixture } from './workFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('private original cleanup job lifetime (actual PostgreSQL)', () => {
  test('the same delivery is renewed past its first deadline while the private callback remains live', async () => {
    const f = await runtimeWorkFixture([queueMigrations]), thirdRenewal = Promise.withResolvers<void>();
    let listener: { unlisten(): Promise<unknown> } | undefined;
    try {
      await enqueueJob(f.database.db, NATIVE_EXECUTION_JOB_KIND, { taskId: f.parent }, { dedupKey: f.parent });
      let renewals = 0;
      listener = await f.database.handle.client.listen('original_cleanup_renewed', () => { if (++renewals >= 3) thirdRenewal.resolve(); });
      await f.database.handle.client.unsafe(`CREATE FUNCTION platform_infra.notify_original_cleanup_renewal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF OLD.state='running' AND NEW.state='running' AND NEW.fencing_token=OLD.fencing_token AND NEW.lease_until>OLD.lease_until THEN
          PERFORM pg_notify('original_cleanup_renewed',NEW.id::text);END IF;RETURN NEW;END $$;
        CREATE TRIGGER original_cleanup_renewal AFTER UPDATE ON platform_infra.jobs FOR EACH ROW EXECUTE FUNCTION platform_infra.notify_original_cleanup_renewal()`);
      // Use actual notification timestamps, not periodic status polling, to cross the first two-second lease.
      // This fixture seals directly; retain the task through its actual original callback first.
      await f.work.run(f.input(), async () => undefined);
      await f.seal();
      const context = await f.context(), input = f.input();
      const jobs = runtimeOriginalJobs(f.database.db, f.sources, { leaseSeconds: 2, renewEveryMs: 750 });
      const timeout = setTimeout(() => thirdRenewal.reject(new Error('missing actual original renewal notifications')), 6000);
      try {
        const resumed = await f.work.runGranted(context, input, () => jobs.run(context, f.parent, async (_identity, heartbeat) => {
          await thirdRenewal.promise;
          expect(await heartbeat()).toBe(true);
          expect(await claimJobs(f.database.db, [NATIVE_EXECUTION_JOB_KIND], 'ordinary-worker', 2, 1)).toEqual([]);
          return 'original-cleanup-finished';
        }));
        expect(resumed).toEqual({ claimed: true, value: 'original-cleanup-finished' });
        expect((await f.work.history(f.project)).every((row) => row.exited)).toBe(true);
        expect((await f.database.db.execute<{ state: string }>(sql`SELECT state FROM platform_infra.jobs WHERE dedup_key=${f.parent}`))[0]?.state).toBe('done');
      } finally { clearTimeout(timeout); }
    } finally { await listener?.unlisten(); await f.drop(); }
  });
  test('the original job cannot be claimed across projects or after its current Root grant has expired', async () => {
    const f = await runtimeWorkFixture([queueMigrations]);
    try {
      const job = await enqueueJob(f.database.db, NATIVE_EXECUTION_JOB_KIND, { taskId: f.otherParent }, { dedupKey: f.otherParent });
      const context = await f.context(), jobs = runtimeOriginalJobs(f.database.db, f.sources);
      await expect(jobs.run(context, f.otherParent, async () => undefined)).rejects.toMatchObject({ kind: 'precondition' });
      expect((await f.database.db.execute<{ state: string }>(sql`SELECT state FROM platform_infra.jobs WHERE id=${job.id}`))[0]?.state).toBe('pending');
      f.permit(false);
      await expect(jobs.run(context, f.parent, async () => undefined)).rejects.toMatchObject({ kind: 'precondition' });
    } finally { await f.drop(); }
  });
});
