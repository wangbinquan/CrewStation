import { describe, expect, test } from 'bun:test';
import { PROJECT_DELETION_PHASES } from '@crewstation/contracts';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { developmentWorkIdentity } from '../../domain/deletion/work';
import { developmentWorkFixture } from './workFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('development granted cleanup (actual PostgreSQL; controlled Root and original physical sources)', () => {
  test('the original stop grant can finish old metadata while ordinary writes and new admissions stay closed', async () => {
    const f = await developmentWorkFixture();
    try {
      const agent = await f.agent();
      const confirmed = await f.owner().inspect(f.target);
      expect((await f.owner().run(f.context(confirmed))).kind).toBe('done');
      expect(await f.repo().legacyPending(f.context(confirmed, 'stop'))).toBe(true);
      const input = { originKind: 'task' as const, originKey: f.workspace, reference: newResourceId(), inputDigest: jsonHash('controlled original ending') };
      const mutation = sql`UPDATE dev_session.agent_starts SET finalized=true WHERE agent_id=${agent.agentId}`;
      await expect(f.database.db.execute(mutation).then(() => undefined)).rejects.toMatchObject({ cause: { message: expect.stringContaining('permanently sealed') } });
      await expect(f.work.run(f.input(), async () => undefined)).rejects.toThrow('永久封闭');
      await f.work.runGranted(f.context(confirmed, 'stop'), input, () => f.work.effect(jsonHash('original close'), async () => {
        await f.database.db.transaction((tx) => tx.execute(mutation));
        await expect(f.database.db.transaction((tx) => tx.execute(sql`INSERT INTO dev_session.workspace_layouts(task_id,user_id,revision,layout)
          VALUES(${f.workspace},${newResourceId()},1,'{}')`)).then(() => undefined)).rejects.toMatchObject({ cause: { message: expect.stringContaining('permanently sealed') } });
      }));
      const history = await f.work.history(f.project);
      expect(history).toHaveLength(2);
      expect(history.every((row) => row.grant?.phase === 'stop' && row.exited && row.exitDigest === developmentWorkIdentity(row))).toBe(true);
      expect(await f.repo().legacyPending(f.context(confirmed, 'stop'))).toBe(false);
      const stopped = await f.owner().run(f.context(confirmed, 'stop')); expect(stopped.kind).toBe('done');
      const scope = await f.repo().scope(f.context(confirmed, 'stop'));
      expect(scope.contents).toHaveLength(1); expect(scope.stopped?.contents).toHaveLength(3);
      expect(scope.stopped?.callbacks).toEqual([...history]);
      for (const phase of PROJECT_DELETION_PHASES.slice(2)) expect((await f.owner().run(f.context(confirmed, phase))).kind).toBe('done');
      expect((await f.owner().inspect(f.target)).resources).toEqual([]);
      expect(await f.database.db.execute('SELECT id FROM dev_session.original_callbacks')).toHaveLength(0);
    } finally { await f.work.drain(); await f.drop(); }
  });

  test('grant revocation retains the issued effect through its private exit and rejects the next request', async () => {
    const f = await developmentWorkFixture(), entered = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
    let pending: Promise<unknown> | undefined;
    try {
      await f.work.run(f.input(), async () => undefined);
      const confirmed = await f.owner().inspect(f.target); await f.owner().run(f.context(confirmed));
      const context = f.context(confirmed, 'stop'), input = { originKind: 'task' as const, originKey: f.workspace, reference: newResourceId(), inputDigest: jsonHash('retained cleanup') };
      let requests = 0;
      pending = f.work.runGranted(context, input, () => f.work.effect(jsonHash('issued original transport'), async () => {
        requests++; entered.resolve(); await resume.promise;
      })).catch(() => 'grant lost');
      await entered.promise; f.permit(false);
      expect((await f.work.history(f.project)).filter((row) => !row.exited)).toHaveLength(2);
      resume.resolve(); expect(await pending).toBe('grant lost'); await f.work.drain(); expect(requests).toBe(1);
      expect((await f.work.history(f.project)).every((row) => row.exited)).toBe(true);
      await expect(f.work.runGranted(context, input, async () => { requests++; })).rejects.toThrow('grant-unavailable');
      expect(requests).toBe(1);
      f.permit(true);
      for (const changed of [{ ...context, generation: 2 }, { ...context, confirmed: { ...confirmed, participant: 'task-runtime' as const } }, f.context(confirmed, 'seal')])
        await expect(f.work.runGranted(changed, input, async () => undefined)).rejects.toThrow();
    } finally { resume.resolve(); await pending; await f.work.drain(); await f.drop(); }
  });

  test('stop scope and witness commit together, resume under a renewed grant and roll back on a late cleanup failure', async () => {
    const f = await developmentWorkFixture();
    try {
      await f.database.db.execute(sql`INSERT INTO dev_session.workspace_layouts(task_id,user_id,revision,layout)
        VALUES(${f.workspace},${newResourceId()},1,'{"original":"private-layout"}')`);
      const confirmed = await f.owner().inspect(f.target); await f.owner().run(f.context(confirmed));
      await f.database.db.execute(`CREATE FUNCTION dev_session.require_atomic_stop() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.body->'stopped' IS DISTINCT FROM OLD.body->'stopped' AND NOT NEW.phases ? 'stop' THEN RAISE EXCEPTION 'original stop witness absent from snapshot commit';END IF;RETURN NEW;END $$;
        CREATE TRIGGER test_atomic_stop BEFORE UPDATE ON dev_session.project_deletions FOR EACH ROW EXECUTE FUNCTION dev_session.require_atomic_stop()`);
      const first = await f.owner().run(f.context(confirmed, 'stop'));
      expect(first.kind).toBe('done');
      expect(await f.owner().run(f.context(confirmed, 'stop', 2))).toEqual(first);
      expect((await f.database.db.execute<{ generation: number }>('SELECT generation FROM dev_session.project_admissions'))[0]?.generation).toBe(2);
      for (const phase of ['purge', 'prove', 'namespace'] as const) await f.owner().run(f.context(confirmed, phase, 2));
      const before = await f.repo().scope(f.context(confirmed, 'metadata', 2));
      await f.database.db.execute(`CREATE FUNCTION dev_session.reject_original_remove() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'controlled original remove failure';END $$;
        CREATE TRIGGER test_remove BEFORE DELETE ON dev_session.workspace_layouts FOR EACH ROW EXECUTE FUNCTION dev_session.reject_original_remove()`);
      await expect(f.owner().run(f.context(confirmed, 'metadata', 2))).rejects.toMatchObject({ cause: { message: 'controlled original remove failure' } });
      expect(await f.repo().scope(f.context(confirmed, 'metadata', 2))).toEqual(before);
      expect(await f.database.db.execute('SELECT task_id FROM dev_session.workspace_layouts')).toHaveLength(1);
      await f.database.db.execute('DROP TRIGGER test_remove ON dev_session.workspace_layouts');
      expect((await f.owner().run(f.context(confirmed, 'metadata', 2))).kind).toBe('done');
      expect((await f.owner().run(f.context(confirmed, 'verify', 2))).kind).toBe('done');
    } finally { await f.drop(); }
  });
});
