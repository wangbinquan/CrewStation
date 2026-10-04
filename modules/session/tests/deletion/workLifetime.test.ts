import { describe, expect, test } from 'bun:test';
import { jsonHash } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { sessionProjectWork } from '../../adapters/persistence/deletion/projectWork';
import { sessionDeletionRepository } from '../../adapters/persistence/deletion/repository';
import { sessionWorkHistory } from '../../adapters/persistence/deletion/workHistory';
import { sessionDeletionFixture } from './fixture';
import { sessionConnectionHistory } from '../../adapters/persistence/deletion/lifetime';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('Session durable original command lifetime (real PG; controlled original ownership)', () => {
  test('every project/platform callback records its full immutable birth and actual private finally, including a rejected callback', async () => {
    const f = await sessionDeletionFixture();
    try {
      const work = sessionProjectWork(f.database.db, f.source), task = f.task(), platform = f.task(null);
      for (const id of [task, platform]) expect(await work.run({ taskKey: id, kind: 'command', reference: 'accepted', inputDigest: jsonHash('private payload') },
        async (handle) => { await handle.check(); return 73; })).toBe(73);
      await expect(work.run({ taskKey: task, kind: 'command', reference: 'rejected', inputDigest: jsonHash('failed') }, async () => { throw new Error('original source failed'); })).rejects.toThrow('original source failed');
      const history = await sessionWorkHistory(f.database.db, f.projectId);
      expect(history).toHaveLength(2); expect(history.every((callback) => callback.exited && callback.exitDigest === callback.identity && callback.recoveryDigest === null)).toBe(true);
      expect(history[0]).toMatchObject({ taskId: task, projectId: f.projectId, kind: 'command', process: null, grant: null });
      expect(JSON.stringify(history)).not.toContain('private payload');
      await expect(f.database.db.execute(sql`UPDATE session.original_callbacks SET reference='replacement' WHERE id=${history[0]!.id}`).then(() => undefined)).rejects.toMatchObject({ cause: { message: expect.stringContaining('identity') } });
      await expect(f.database.db.execute('DELETE FROM session.original_callbacks').then(() => undefined)).rejects.toMatchObject({ cause: { message: expect.stringContaining('metadata') } });
      await expect(f.database.db.execute('TRUNCATE session.original_callbacks').then(() => undefined)).rejects.toMatchObject({ cause: { message: expect.stringContaining('truncated') } });
      await work.drain();
      const other = f.task(f.otherProject); await sessionConnectionHistory(f.database.db, f.source).check(other);
      await expect(work.run({ taskKey: task, kind: 'command', reference: 'cross task', inputDigest: jsonHash('other') },
        () => work.database.execute(sql`INSERT INTO session.runner_events(task_id,seq,at,kind,event) VALUES(${other},1,now(),'agent','{}')`).then(() => undefined)))
        .rejects.toMatchObject({ cause: { message: expect.stringContaining('another task') } });
      expect(await f.database.db.execute('SELECT seq FROM session.runner_events')).toHaveLength(0);
      f.origins.set(task, { ...f.origins.get(task)!, revision: jsonHash('replacement source') });
      await expect(work.run({ taskKey: task, kind: 'command', reference: 'new source', inputDigest: jsonHash('new') }, async () => undefined)).rejects.toThrow('冲突');
    } finally { await f.drop(); }
  });

  test('a rejected real guard connection cannot fake callback exit; seal can advance but stop waits for the issued effect and private finally', async () => {
    const f = await sessionDeletionFixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    const work = sessionProjectWork(f.database.db, f.source), task = f.task();
    let body: Promise<unknown> | undefined;
    try {
      body = work.run({ taskKey: task, kind: 'command', reference: 'original wire', inputDigest: jsonHash('issued') }, async (handle) => handle.retain(async () => {
        entered.resolve(); await release.promise;
        await work.database.transaction((tx) => tx.execute(sql`INSERT INTO session.runner_events(task_id,seq,at,kind,event) VALUES(${task},1,now(),'agent','{}')`).then(() => undefined));
      }));
      const rejected = body.catch((error: unknown) => error); await entered.promise;
      const birth = (await sessionWorkHistory(f.database.db, f.projectId))[0]!;
      const admitted = await f.database.db.execute(sql`SELECT pid FROM pg_locks WHERE pid=${birth.backendPid} AND locktype='advisory' AND granted AND mode='ShareLock'`);
      expect(admitted.length).toBeGreaterThan(0);
      await f.database.db.execute(sql`SELECT pg_terminate_backend(${birth.backendPid})`); expect(await rejected).toBeInstanceOf(Error);
      const context = await f.context(), owner = f.first.module.api.deletionOwner!;
      expect((await owner.run(context)).kind).toBe('done');
      expect(await owner.run({ ...context, phase: 'stop' })).toMatchObject({ kind: 'waiting' });
      await expect(sessionDeletionRepository(f.database.db, f.source).record({ ...context, phase: 'stop' },
        { kind: 'metadata', count: 1, digest: jsonHash('fake completed callback'), description: 'must not become a stop proof' })).rejects.toThrow('尚未全部退出');
      expect((await sessionWorkHistory(f.database.db, f.projectId))[0]!.exited).toBe(false);
      let drained = false; const drain = work.drain().then(() => { drained = true; });
      await Promise.resolve(); expect(drained).toBe(false);
      release.resolve(); await drain;
      expect((await sessionWorkHistory(f.database.db, f.projectId))[0]!.exited).toBe(true);
      expect(await f.database.db.execute('SELECT seq FROM session.runner_events')).toHaveLength(0);
      expect((await owner.run({ ...context, phase: 'stop' })).kind).toBe('done');
    } finally { release.resolve(); await body?.catch(() => undefined); await work.drain(); await f.drop(); }
  });

  test('an already issued original callback can finish its UOW while exclusive seal is queued, then future ordinary admission stays closed', async () => {
    const f = await sessionDeletionFixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    const work = sessionProjectWork(f.database.db, f.source), task = f.task();
    let body: Promise<unknown> | undefined;
    try {
      body = work.run({ taskKey: task, kind: 'command', reference: 'original', inputDigest: jsonHash('old') }, async () => {
        entered.resolve(); await release.promise;
        await work.database.transaction((tx) => tx.execute(sql`INSERT INTO session.runner_events(task_id,seq,at,kind,event) VALUES(${task},1,now(),'agent','{}')`).then(() => undefined));
      });
      await entered.promise; const context = await f.context(), owner = f.first.module.api.deletionOwner!;
      f.deleting(); const sealing = owner.run(context); const checked = sealing.catch((error: unknown) => error);
      const deadline = Date.now() + 2000;
      while (!(await f.database.db.execute("SELECT pid FROM pg_locks WHERE locktype='advisory' AND mode='ExclusiveLock' AND NOT granted")).length && Date.now() < deadline) await Bun.sleep(5);
      expect((await sessionWorkHistory(f.database.db, f.projectId))[0]!.exited).toBe(false);
      release.resolve(); await body; expect(await checked).toMatchObject({ kind: 'blocked', blockers: [{ code: 'inventory-changed' }] });
      expect(await f.database.db.execute('SELECT seq FROM session.runner_events')).toHaveLength(1);
      await expect(work.run({ taskKey: task, kind: 'command', reference: 'late', inputDigest: jsonHash('late') }, async () => undefined)).rejects.toThrow('project deleting');
      const renewed = { ...await f.context(), generation: 2 }; expect((await owner.run(renewed)).kind).toBe('done');
      expect((await owner.run({ ...renewed, phase: 'stop' })).kind).toBe('done');
    } finally { release.resolve(); await body?.catch(() => undefined); await work.drain(); await f.drop(); }
  });
});
