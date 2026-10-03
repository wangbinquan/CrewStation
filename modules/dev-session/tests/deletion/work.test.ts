import { describe, expect, test } from 'bun:test';
import type { ProjectDeletionStepResult } from '@crewstation/contracts';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { withSharedDatabaseAdmission } from '@crewstation/persistence';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { developmentWorkIdentity } from '../../domain/deletion/work';
import { developmentWorkFixture } from './workFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('development original work (actual PG; controlled public origins and whole-Pod witnesses)', () => {
  test('a bounded response keeps outstanding effects and private finally alive; seal waits without blocking another project', async () => {
    const f = await developmentWorkFixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(), deadline = Promise.withResolvers<string>(), later = Promise.withResolvers<void>();
    let command: Promise<unknown> | undefined, late: Promise<unknown> | undefined, sealing: Promise<ProjectDeletionStepResult> | undefined;
    try {
      let effects = 0;
      const response = f.work.runResponse(f.input(), async () => {
        command = f.work.effect(jsonHash('original-bounded-command'), async () => { entered.resolve(); await release.promise; return 'actual reply'; }).catch(() => 'fenced');
        late = later.promise.then(() => f.work.effect(jsonHash('late-command'), async () => { effects++; })).catch(() => 'closed');
        return Promise.race([command.then(String), deadline.promise]);
      });
      await entered.promise; deadline.resolve('bounded response'); expect(await response).toBe('bounded response');
      const before = await f.work.history(f.project); expect(before).toHaveLength(2); expect(before.every((row) => !row.exited)).toBe(true);
      expect(new Set(before.map((row) => row.backendPid)).size).toBe(1);
      later.resolve(); expect(await late).toBe('closed'); expect(effects).toBe(0);
      const confirmed = await f.owner().inspect(f.target); let sealed = false;
      sealing = f.owner().run(f.context(confirmed)).then((value) => { sealed = true; return value; });
      await f.waitSeal(); await f.work.run(f.input(f.otherProject, f.otherWorkspace), async () => undefined);
      expect(sealed).toBe(false); expect(await f.work.history(f.otherProject)).toHaveLength(1);
      release.resolve(); expect(await command).toBe('actual reply'); await f.work.drain(); expect((await sealing).kind).toBe('done');
      const ended = await f.work.history(f.project); expect(ended.every((row) => row.exited && row.exitDigest === developmentWorkIdentity(row))).toBe(true);
      expect(f.lifetimeErrors).toEqual([]); await expect(f.work.run(f.input(), async () => undefined)).rejects.toThrow('永久封闭');
    } finally { release.resolve(); deadline.resolve('cleanup'); later.resolve(); await command; await late; await sealing?.catch(() => undefined); await f.work.drain(); await f.drop(); }
  });

  test('loss of the admitted DB backend preserves the pending original callback and rejects later effects', async () => {
    const f = await developmentWorkFixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    let running: Promise<unknown> | undefined;
    try {
      let effects = 0;
      running = f.work.run(f.input(), async () => { entered.resolve(); await release.promise; await f.work.effect(jsonHash('late-after-driver-loss'), async () => { effects++; }); }).catch(() => 'disconnected');
      await entered.promise; const [birth] = await f.work.history(f.project);
      await f.database.db.execute(sql`SELECT pg_terminate_backend(${birth!.backendPid})`); expect(await running).toBe('disconnected');
      const confirmed = await f.owner().inspect(f.target); expect((await f.owner().run(f.context(confirmed))).kind).toBe('done');
      expect((await f.owner().run(f.context(confirmed, 'stop'))).kind).toBe('waiting');
      f.containerStopped(true); expect((await f.owner().run(f.context(confirmed, 'stop'))).kind).toBe('waiting');
      release.resolve(); await f.waitExit(birth!.id); expect(effects).toBe(0); await f.work.drain();
      expect((await f.owner().inspect(f.target)).revision).toBe(confirmed.revision);
      expect((await f.owner().run(f.context(confirmed, 'stop'))).kind).toBe('done');
    } finally { release.resolve(); await running; await f.work.drain(); await f.drop(); }
  });

  test('original callback births, private exits and minimum origins cannot be fabricated, rewritten or truncated', async () => {
    const f = await developmentWorkFixture();
    try {
      await f.work.run(f.input(), async () => { await expect(f.work.run(f.input(f.otherProject, f.otherWorkspace), async () => undefined)).rejects.toThrow('另一项目'); });
      const [birth] = await f.work.history(f.project);
      for (const mutation of [sql`UPDATE dev_session.original_callbacks SET input_digest=${jsonHash('replacement')} WHERE id=${birth!.id}`,
        sql`DELETE FROM dev_session.original_callbacks WHERE id=${birth!.id}`, sql`TRUNCATE dev_session.original_callbacks`,
        sql`UPDATE dev_session.content_origins SET project_id=${f.otherProject}`, sql`TRUNCATE dev_session.content_origins`])
        await expect(f.database.db.execute(mutation).then(() => undefined)).rejects.toThrow();
      await withSharedDatabaseAdmission(f.database.db, 'dev-session.project-admission:' + f.project, async (guard) => {
        const pid = (await guard.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`))[0]!.pid;
        await expect(f.database.db.transaction((tx) => tx.execute(sql`INSERT INTO dev_session.original_callbacks(id,project_id,origin_kind,origin_key,origin_id,kind,reference,consumer_id,input_digest,origin_revision,backend_pid,original_process,exit_key_hash,exited_at,exit_digest)
          SELECT ${newResourceId()},project_id,origin_kind,origin_key,origin_id,kind,reference,${newResourceId()},input_digest,origin_revision,${pid},original_process,exit_key_hash,now(),exit_digest
          FROM dev_session.original_callbacks WHERE id=${birth!.id}`))).rejects.toThrow();
        await expect(f.database.db.transaction((tx) => tx.execute(sql`INSERT INTO dev_session.original_callbacks(id,project_id,origin_kind,origin_key,origin_id,kind,reference,consumer_id,input_digest,origin_revision,backend_pid,original_process,exit_key_hash)
          SELECT ${newResourceId()},project_id,origin_kind,origin_key,${newResourceId()},kind,reference,${newResourceId()},input_digest,origin_revision,${pid},original_process,exit_key_hash
          FROM dev_session.original_callbacks WHERE id=${birth!.id}`))).rejects.toMatchObject({ cause: { message: expect.stringContaining('original public source') } });
      });
      f.protect({ ...f.processIdentity, pid: process.pid + 1 }); await expect(f.work.run(f.input(), async () => undefined)).rejects.toThrow('PID'); f.protect(f.processIdentity);
      await expect(f.work.run({ ...f.input(), inputDigest: 'incomplete' }, async () => undefined)).rejects.toThrow();
      await expect(f.work.run(f.input(f.otherProject, f.workspace), async () => undefined)).rejects.toThrow('归属不符');
      f.deleting(true); await expect(f.work.run(f.input(), async () => undefined)).rejects.toThrow('project-deleting');
      expect(await f.work.history(f.project)).toEqual([birth!]);
    } finally { await f.drop(); }
  });

  test('full original history traverses 205 pending callbacks and only the same whole Pod and node can recover them', async () => {
    const f = await developmentWorkFixture();
    try {
      await f.work.run(f.input(), async () => undefined);
      const originals = Array.from({ length: 205 }, () => ({ id: newResourceId(), reference: newResourceId(), consumer: newResourceId() }));
      await withSharedDatabaseAdmission(f.database.db, 'dev-session.project-admission:' + f.project, async (guard) => {
        const pid = (await guard.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`))[0]!.pid;
        await f.database.db.transaction((tx) => tx.execute(sql`INSERT INTO dev_session.original_callbacks(id,project_id,origin_kind,origin_key,origin_id,kind,reference,consumer_id,input_digest,origin_revision,backend_pid,original_process,exit_key_hash)
          SELECT r.id,${f.project},'task',${f.workspace},${f.workspace},'native-dispatch',r.reference,r.consumer,${jsonHash('original-input')},${f.origins.get('task:' + f.workspace)!.revision},${pid},${JSON.stringify(f.processIdentity)}::jsonb,${jsonHash('private-original-exit')}
          FROM jsonb_to_recordset(${JSON.stringify(originals)}::jsonb) r(id text,reference text,consumer text)`));
      });
      expect(await f.work.history(f.project)).toHaveLength(206); await f.work.observe(); expect(f.releasable.at(-1)).toBe(false);
      f.containerStopped(true); await f.work.observe(); expect((await f.work.history(f.project)).filter((row) => !row.exited)).toHaveLength(205);
      f.stopped(true); f.stopIdentity({ podUid: f.processIdentity.podUid, nodeUid: newResourceId(), nodeName: f.processIdentity.nodeName });
      await f.work.observe(); expect((await f.work.history(f.project)).filter((row) => !row.exited)).toHaveLength(205);
      f.stopIdentity({ podUid: f.processIdentity.podUid, nodeUid: f.processIdentity.nodeUid, nodeName: f.processIdentity.nodeName }); await f.work.observe();
      const ended = await f.work.history(f.project); expect(ended.every((row) => row.exited && row.exitDigest === developmentWorkIdentity(row, row.recoveryDigest ?? undefined))).toBe(true);
      expect(f.releasable.at(-1)).toBe(true); await f.work.observe(); expect(await f.work.history(f.project)).toEqual(ended);
      for (const mutation of ['DELETE FROM dev_session.callback_pod_stops', 'TRUNCATE dev_session.callback_pod_stops']) await expect(f.database.db.execute(mutation).then(() => undefined)).rejects.toThrow();
      await f.database.db.execute('ALTER TABLE dev_session.callback_pod_stops ADD COLUMN unknown_payload text');
      expect(await f.owner().inspect(f.target)).toMatchObject({ complete: false, blockers: [{ code: 'source-unavailable' }] });
    } finally { await f.drop(); }
  });
});
