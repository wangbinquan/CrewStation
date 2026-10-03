import { describe, expect, test } from 'bun:test';
import { BUILTIN_RESOURCES } from '@crewstation/contracts';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { withSharedDatabaseAdmission } from '@crewstation/persistence';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { runtimeProjectAdmissionKey } from '../../adapters/persistence/deletion/projectWork';
import { originalRuntimeWorkInfrastructure } from '../../adapters/persistence/deletion/workOrigin';
import { runtimeWorkIdentity } from '../../domain/deletion/work';
import { runtimeWorkFixture } from './workFixture';
import { corruptRuntimeContent } from './contentFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('TaskRuntime original work (actual PG; controlled public owners and whole-Pod witnesses)', () => {
  test('a bounded caller keeps child I/O and its original finally alive; seal waits without blocking another project', async () => {
    const f = await runtimeWorkFixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(), deadline = Promise.withResolvers<string>(), later = Promise.withResolvers<void>();
    let command: Promise<unknown> | undefined, late: Promise<unknown> | undefined, sealing: Promise<unknown> | undefined;
    try {
      let effects = 0, sealed = false;
      const response = f.work.runResponse(f.input(), async () => {
        command = f.work.effect(jsonHash('bounded-runtime-effect'), async () => { entered.resolve(); await release.promise; return 'original reply'; });
        late = later.promise.then(() => f.work.effect(jsonHash('late-runtime-effect'), async () => { effects++; })).catch(() => 'closed');
        return Promise.race([command.then(String), deadline.promise]);
      });
      await entered.promise; deadline.resolve('bounded response'); expect(await response).toBe('bounded response');
      const births = await f.work.history(f.project); expect(births).toHaveLength(2); expect(births.every((row) => !row.exited)).toBe(true);
      expect(new Set(births.map((row) => row.backendPid)).size).toBe(1);
      later.resolve(); expect(await late).toBe('closed'); expect(effects).toBe(0);
      sealing = f.seal().then(() => { sealed = true; }); await f.waitSeal();
      await f.work.run(f.input(f.otherProject, f.otherParent), async () => undefined); expect(sealed).toBe(false);
      release.resolve(); expect(await command).toBe('original reply'); await f.work.drain(); await sealing;
      expect((await f.work.history(f.project)).every((row) => row.exited && row.exitDigest === runtimeWorkIdentity(row))).toBe(true);
      await expect(f.work.run(f.input(), async () => undefined)).rejects.toThrow('永久封闭'); expect(f.errors).toEqual([]);
    } finally { release.resolve(); deadline.resolve('cleanup'); later.resolve(); await command; await late; await sealing?.catch(() => undefined); await f.work.drain(); await f.drop(); }
  });

  test('losing the admitted backend never fabricates an exit and prevents a late physical effect', async () => {
    const f = await runtimeWorkFixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    let running: Promise<unknown> | undefined;
    try {
      let effects = 0;
      running = f.work.run(f.input(), async () => { entered.resolve(); await release.promise; await f.work.effect(jsonHash('after-driver-loss'), async () => { effects++; }); }).catch(() => 'disconnected');
      await entered.promise; const [birth] = await f.work.history(f.project); await f.database.db.execute(sql`SELECT pg_terminate_backend(${birth!.backendPid})`);
      expect(await running).toBe('disconnected'); await f.seal(); expect((await f.work.history(f.project))[0]?.exited).toBe(false);
      f.containerStopped(true); await f.work.observe(); expect((await f.work.history(f.project))[0]?.exited).toBe(false);
      release.resolve(); await f.waitExit(birth!.id); await f.work.drain(); expect(effects).toBe(0);
      expect((await f.work.history(f.project))[0]?.exitDigest).toBe(runtimeWorkIdentity(birth!));
    } finally { release.resolve(); await running; await f.work.drain(); await f.drop(); }
  });

  test('sealed cleanup requires the same original deletion generation and a live grant before and after I/O', async () => {
    const f = await runtimeWorkFixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    let pending: Promise<unknown> | undefined;
    try {
      await f.work.run(f.input(), async () => undefined); await f.seal(); f.deleting(true);
      const context = await f.context(), input = { originKind: 'task' as const, originKey: f.parent, reference: newResourceId(), inputDigest: jsonHash('delete-runtime') };
      let effects = 0;
      pending = f.work.runGranted(context, input, () => f.work.effect(jsonHash('original-cleanup'), async () => { effects++; entered.resolve(); await release.promise; })).catch(() => 'grant lost');
      await entered.promise; f.permit(false); release.resolve(); expect(await pending).toBe('grant lost'); await f.work.drain(); expect(effects).toBe(1);
      await expect(f.work.runGranted(context, input, async () => undefined)).rejects.toThrow('grant-unavailable');
      f.permit(true); await f.seal(2); await expect(f.work.runGranted(context, input, async () => undefined)).rejects.toThrow('世代');
      const next = await f.context('stop', 2); await f.work.runGranted(next, input, async () => undefined);
      await expect(f.work.runGranted(await f.context('seal', 2), input, async () => undefined)).rejects.toThrow();
      const history = await f.work.history(f.project); expect(history.filter((row) => row.grant).every((row) => row.exited)).toBe(true);
      expect(history.some((row) => row.grant?.generation === 2)).toBe(true);
      const selected = await f.context('stop', 2), started = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
      const protectedCall = f.work.runGranted(selected, input, async () => { started.resolve(); await resume.promise;
        return f.work.effect(jsonHash('private-original-grant'), async () => 'same original grant'); });
      await started.promise; Reflect.set(selected, 'phase', 'prove'); Reflect.set(selected.target, 'id', f.otherProject); resume.resolve();
      expect(await protectedCall).toBe('same original grant'); await f.work.drain();
      expect((await f.work.history(f.project)).at(-1)?.grant?.phase).toBe('stop');
    } finally { release.resolve(); await pending; await f.work.drain(); await f.drop(); }
  });

  test('immutable original source survives payload purge, while mismatched scope, births and private exits are rejected', async () => {
    const f = await runtimeWorkFixture();
    try {
      await f.work.run(f.input(), async () => { await expect(f.work.run(f.input(f.otherProject, f.otherParent), async () => undefined)).rejects.toThrow('另一项目'); });
      const [birth] = await f.work.history(f.project), before = await originalRuntimeWorkInfrastructure(f.database.db, 'task', f.parent);
      for (const mutation of [sql`UPDATE task_runtime.original_callbacks SET input_digest=${jsonHash('replacement')} WHERE id=${birth!.id}`,
        sql`DELETE FROM task_runtime.original_callbacks`, sql`TRUNCATE task_runtime.original_callbacks`, sql`TRUNCATE task_runtime.work_origins`,
        sql`UPDATE task_runtime.work_origins SET project_id=${f.otherProject}`, sql`INSERT INTO task_runtime.project_admissions VALUES(${f.project},${newResourceId()},1,${jsonHash('fake')})`])
        await expect(f.database.db.execute(mutation).then(() => undefined)).rejects.toThrow();
      f.protect({ ...f.original, pid: process.pid + 1 }); await expect(f.work.run(f.input(), async () => undefined)).rejects.toThrow('PID'); f.protect(f.original);
      await expect(f.work.run(f.input(f.otherProject, f.parent), async () => undefined)).rejects.toThrow('归属不符');
      await f.database.db.execute(sql`DELETE FROM task_runtime.environments WHERE id=${f.parent}`);
      expect(await originalRuntimeWorkInfrastructure(f.database.db, 'task', f.parent)).toEqual(before);
      await expect(f.environment({ id: f.parent, projectId: f.otherProject, serviceId: f.otherService })).rejects.toThrow();
      await corruptRuntimeContent(f, 'environments', () => f.environment({ id: f.parent, projectId: f.otherProject, serviceId: f.otherService }));
      await expect(f.work.run(f.input(), async () => undefined)).rejects.toThrow('沿革冲突');
      expect(await f.work.history(f.project)).toEqual([birth!]);
    } finally { await f.drop(); }
  });

  test('206 original callbacks reach a true EOF; only the same whole Pod and original node recover missing finalies', async () => {
    const f = await runtimeWorkFixture();
    try {
      await f.work.run(f.input(), async () => undefined); const [birth] = await f.work.history(f.project);
      const originals = Array.from({ length: 205 }, () => ({ id: newResourceId(), reference: newResourceId(), consumer: newResourceId() }));
      await withSharedDatabaseAdmission(f.database.db, runtimeProjectAdmissionKey(f.project), async (guard) => {
        const pid = (await guard.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`))[0]!.pid;
        await f.database.db.transaction((tx) => tx.execute(sql`INSERT INTO task_runtime.original_callbacks(id,project_id,origin_kind,origin_key,origin_id,kind,reference,consumer_id,input_digest,origin_revision,backend_pid,original_process,exit_key_hash)
          SELECT r.id,${f.project},'task',${f.parent},${f.parent},'native-job',r.reference,r.consumer,${jsonHash('original-input')},${birth!.originRevision},${pid},${JSON.stringify(f.original)}::jsonb,${jsonHash('private-exit')}
          FROM jsonb_to_recordset(${JSON.stringify(originals)}::jsonb) r(id text,reference text,consumer text)`));
      });
      expect(await f.work.history(f.project)).toHaveLength(206); const frozen = (await f.inspect()).inventory;
      expect(frozen.resources.find((row) => row.id === 'original_callbacks')?.count).toBe(206);
      await f.work.observe(); expect(f.releasable.at(-1)).toBe(false); f.containerStopped(true); await f.work.observe();
      expect((await f.work.history(f.project)).filter((row) => !row.exited)).toHaveLength(205);
      f.stopped(true); f.stopIdentity({ podUid: f.original.podUid, nodeUid: newResourceId(), nodeName: f.original.nodeName }); await f.work.observe();
      expect((await f.work.history(f.project)).filter((row) => !row.exited)).toHaveLength(205);
      f.stopIdentity({ podUid: f.original.podUid, nodeUid: f.original.nodeUid, nodeName: f.original.nodeName }); await f.work.observe();
      const ended = await f.work.history(f.project); expect(ended.every((row) => row.exited && row.exitDigest === runtimeWorkIdentity(row, row.recoveryDigest ?? undefined))).toBe(true);
      expect(f.releasable.at(-1)).toBe(true); await f.work.observe(); expect(await f.work.history(f.project)).toEqual(ended);
      expect((await f.inspect()).inventory.revision).toBe(frozen.revision);
      await expect(f.database.db.execute('TRUNCATE task_runtime.callback_pod_stops').then(() => undefined)).rejects.toThrow();
    } finally { await f.drop(); }
  }, 30_000);

  test('accepted unprovisioned business tasks keep their identity after provisioning; shared platform tests do not enter project history', async () => {
    const f = await runtimeWorkFixture();
    try {
      const reserved = newResourceId(); f.bind('business-task', reserved);
      const input = { originKind: 'task' as const, originKey: reserved, kind: 'task-api' as const, reference: newResourceId(), inputDigest: jsonHash('never-provisioned') };
      await f.work.runOrigin(input, async () => undefined); await f.environment({ id: reserved, kind: 'business' }); await f.work.runOrigin(input, async () => undefined);
      const shared = await f.environment({ kind: 'profile-test', projectId: BUILTIN_RESOURCES.profileTestProject, serviceId: BUILTIN_RESOURCES.profileTestService });
      let calls = 0; await f.work.runOrigin({ ...input, originKey: shared }, async () => { calls++; });
      expect(calls).toBe(1); expect(await f.work.history(f.project)).toHaveLength(2);
      await f.work.run(f.input(), async () => { await expect(f.work.runOrigin({ ...input, originKey: shared }, async () => { calls++; })).rejects.toThrow('平台测试范围'); });
      expect(calls).toBe(1);
      await expect(f.work.runOrigin({ ...input, originKey: newResourceId() }, async () => undefined)).rejects.toThrow('原来源缺失');
      await expect(f.work.run({ ...f.input(), inputDigest: 'incomplete' }, async () => undefined)).rejects.toThrow();
      f.deleting(true); await expect(f.work.run(f.input(), async () => undefined)).rejects.toThrow('project-deleting');
    } finally { await f.drop(); }
  });
});
