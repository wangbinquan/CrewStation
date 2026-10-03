import { describe, expect, test } from 'bun:test';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { sql } from 'drizzle-orm';
import { DevelopmentParentEpochSchema, developmentParentEpochHash } from '../../domain/development/parentEnding';
import { DEVELOPMENT_PARENT_ENDING_JOB_KIND } from '../../ports/developmentParentEnding';
import { runtimeWorkModuleFixture } from './workModuleFixture';

type Fixture = Awaited<ReturnType<typeof runtimeWorkModuleFixture>>;
type RecoveryWorker = { start(): void; runOnce(): Promise<number>; stop(): Promise<void> };
const available = await testDatabaseAvailable();

/** Controlled original epochs only; actual PG/factory queues, no physical stopping or model execution. */
async function ending(f: Fixture, other = false) {
  const id = newResourceId(), parentId = other ? f.otherParent : f.parent, projectId = other ? f.otherProject : f.project;
  const epoch = DevelopmentParentEpochSchema.parse({ version: 1, parentId, projectId, serviceId: other ? f.otherService : f.service, kind: 'dev-session',
    volumeMode: 'persistent', namespace: projectId, podName: 'original-pod-' + parentId, podUid: newResourceId(), pvcName: 'work-' + parentId,
    pvcUid: newResourceId(), profile: 'original-profile', labels: {}, runnerTokenHash: '1'.repeat(64), originalRenderStart: null, acceptedRender: null });
  await f.database.db.execute(sql`INSERT INTO task_runtime.development_parent_endings
    (id,parent_id,project_id,operation,epoch,epoch_hash,selection_hash,intent,phase,status,retry_at,created_at,updated_at)
    VALUES(${id},${parentId},${projectId},'release',${JSON.stringify(epoch)}::jsonb,${developmentParentEpochHash(epoch)},${jsonHash({ id, epoch })},
      '{"controlled":"original-stop-intent"}'::jsonb,'admission-sealed','pending',now(),now(),now())`);
  return id;
}
const recovery = (f: Fixture) => f.module.workers[5] as RecoveryWorker;
const jobs = async (f: Fixture) => (await f.database.db.execute<{ dedup_key: string; state: string }>(sql`SELECT dedup_key,state FROM platform_infra.jobs
  WHERE kind=${DEVELOPMENT_PARENT_ENDING_JOB_KIND} ORDER BY id`)).map((row) => ({ ...row }));
async function waitQueue(f: Fixture, key: string) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const [row] = await f.database.db.execute<{ waiting: boolean }>(sql`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted
      AND classid=((hashtextextended(${key},0)>>32)&4294967295)::oid AND objid=(hashtextextended(${key},0)&4294967295)::oid AND objsubid=1) AS waiting`);
    if (row!.waiting) return;
    await Bun.sleep(10);
  }
  throw new Error('original recovery enqueue did not reach the actual PG gate');
}

describe.skipIf(!available)('original parent recovery project admission (actual PG/factory; controlled originals)', () => {
  test('global cursor maintenance survives a closed project, but only the other original project can publish a recovery job', async () => {
    const f = await runtimeWorkModuleFixture();
    try {
      const first = await ending(f), second = await ending(f, true); await f.seal();
      expect(await recovery(f).runOnce()).toBe(1);
      expect(await jobs(f)).toEqual([{ dedup_key: second, state: 'pending' }]);
      expect(await f.work.history(f.project)).toEqual([]);
      const history = await f.work.history(f.otherProject);
      expect(history.some((row) => row.kind === 'parent-recovery' && row.originKind === 'parent-ending' && row.originKey === second)).toBe(true);
      expect(history.every((row) => row.exited)).toBe(true);
      expect((await f.database.db.execute(sql`SELECT id FROM task_runtime.development_parent_endings WHERE id=${first}`))).toHaveLength(1);
      expect((await f.database.db.execute(sql`SELECT epoch FROM task_runtime.development_parent_recovery_sweep`))).toHaveLength(1);
    } finally { await f.drop(); }
  });
  test('the cursor commits before project work, seal waits for the actual enqueue commit, and stop waits for the original iteration', async () => {
    const f = await runtimeWorkModuleFixture(), acquired = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    let blocker: Promise<unknown> | undefined, iteration: Promise<number> | undefined, sealing: Promise<void> | undefined, stopping: Promise<void> | undefined;
    try {
      const first = await ending(f), second = await ending(f, true), key = 'runtime.recovery-test:' + first;
      await f.database.handle.client.unsafe(`CREATE FUNCTION task_runtime.pause_test_recovery() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.kind='task-runtime.development-parent-ending' THEN PERFORM pg_advisory_xact_lock(hashtextextended('runtime.recovery-test:'||NEW.dedup_key,0));END IF;
        RETURN NEW;END $$; CREATE TRIGGER pause_test_recovery AFTER INSERT ON platform_infra.jobs FOR EACH ROW EXECUTE FUNCTION task_runtime.pause_test_recovery();
        CREATE FUNCTION task_runtime.require_test_recovery_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.kind='parent-recovery' AND NEW.exited_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM platform_infra.jobs
          WHERE kind='task-runtime.development-parent-ending' AND dedup_key=NEW.origin_key) THEN RAISE EXCEPTION 'original queue commit missing before private finally';END IF;
        RETURN NEW;END $$; CREATE TRIGGER require_test_recovery_commit BEFORE UPDATE ON task_runtime.original_callbacks
        FOR EACH ROW EXECUTE FUNCTION task_runtime.require_test_recovery_commit()`);
      blocker = f.database.db.transaction(async (tx) => { await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`); acquired.resolve(); await release.promise; });
      await acquired.promise;
      const worker = recovery(f); iteration = worker.runOnce(); expect(worker.runOnce()).toBe(iteration); await waitQueue(f, key);
      // A separate PG transaction can lock the cursor while the admitted project enqueue is still blocked.
      expect(await f.database.db.transaction((tx) => tx.execute(sql`SELECT epoch FROM task_runtime.development_parent_recovery_sweep FOR UPDATE NOWAIT`))).toHaveLength(1);
      expect(await jobs(f)).toEqual([]);
      expect((await f.work.history(f.project)).some((row) => row.kind === 'parent-recovery' && !row.exited)).toBe(true);
      let sealed = false, stopped = false;
      sealing = f.seal().then(() => { sealed = true; }); stopping = worker.stop().then(() => { stopped = true; });
      await f.waitSeal(); expect(sealed).toBe(false); expect(stopped).toBe(false);
      release.resolve(); expect(await iteration).toBe(2); await Promise.all([blocker, sealing, stopping]);
      expect(sealed && stopped).toBe(true);
      expect(await jobs(f)).toEqual([{ dedup_key: first, state: 'pending' }, { dedup_key: second, state: 'pending' }]);
      expect((await f.work.history(f.project)).every((row) => row.exited)).toBe(true);
      expect((await f.work.history(f.otherProject)).every((row) => row.exited)).toBe(true);
    } finally { release.resolve(); await Promise.allSettled([blocker, iteration, sealing, stopping].filter((value) => value !== undefined)); await f.drop(); }
  });
});
