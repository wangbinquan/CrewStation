import { describe, expect, test } from 'bun:test';
import { PROJECT_DELETION_PHASES } from '@crewstation/contracts';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { runtimeOwnerFixture } from './ownerFixture';
import { corruptRuntimeContent } from './contentFixture';
import { expectParentStorageRejection } from '../developmentParentEndingStorageFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('TaskRuntime persistent content owner (actual PG; controlled original stopping)', () => {
  test('all seven phases clear every project payload and original fixed member, keep another project, and compact only minimum proof', async () => {
    const f = await runtimeOwnerFixture();
    try {
      const before = await f.repository.inspect(f.target);
      const other = (await f.database.db.execute<{ body: unknown }>(sql`SELECT to_jsonb(r) AS body FROM task_runtime.environments r WHERE id=${f.otherParent}`))[0]!.body;
      const results = await f.through('verify');
      expect(results.map((row) => row.kind)).toEqual(PROJECT_DELETION_PHASES.map(() => 'done'));
      expect(f.stopCalls()).toBe(1); expect((await f.repository.inspect(f.target)).scope.count).toBe(0);
      expect(await f.work.history(f.project)).toEqual([]);
      expect((await f.database.db.execute<{ body: unknown }>(sql`SELECT to_jsonb(r) AS body FROM task_runtime.environments r WHERE id=${f.otherParent}`))[0]!.body).toEqual(other);
      expect((await f.database.db.execute(sql`SELECT epoch FROM task_runtime.development_parent_recovery_sweep`))).toHaveLength(1);
      const [journal] = await f.database.db.execute<{ body: { contents: unknown[]; callbacks: unknown[]; stopped: unknown; compacted: boolean; count: number }; phases: Record<string, unknown> }>(sql`
        SELECT body,phases FROM task_runtime.project_deletions WHERE project_id=${f.project}`);
      expect(journal!.body).toMatchObject({ contents: [], callbacks: [], stopped: null, compacted: true, count: before.scope.count });
      expect(Object.keys(journal!.phases).sort()).toEqual([...PROJECT_DELETION_PHASES].sort());
      expect(JSON.stringify(journal)).not.toContain('archive-private-DSN');
      expect((await f.database.db.execute(sql`SELECT key FROM task_runtime.work_origins WHERE project_id=${f.project}`)).length).toBeGreaterThan(5);
      await expectParentStorageRejection(f.environment({ id: f.parent }), 'permanently sealed');
      await expectParentStorageRejection(f.environment({ id: f.parent, projectId: f.otherProject, serviceId: f.otherService }), 'original content project links conflict');
      f.origins.delete('project:' + f.project); f.origins.delete('service:' + f.service);
      expect((await f.owner.inspect(f.target)).complete).toBe(true);
      expect((await f.owner.inspect(f.target)).resources).toEqual([]);
      f.unavailable.add('project:' + f.project);
      expect((await f.owner.inspect(f.target)).complete).toBe(false);
    } finally { await f.drop(); }
  });
  test('stop waiting and stage ordering retain the original scope; renewal uses the same operation and rejects stale or replaced grants', async () => {
    const f = await runtimeOwnerFixture(false);
    try {
      expect((await f.run('seal')).kind).toBe('done');
      await expect(f.run('metadata')).rejects.toMatchObject({ kind: 'precondition' });
      f.stopReady(false); expect((await f.run('stop')).kind).toBe('waiting');
      expect((await f.repository.scope(f.context())).stopped).toBeNull();
      f.stopReady(true); expect((await f.run('stop', 2)).kind).toBe('done');
      expect(f.stopCalls()).toBe(2); const frozen = await f.repository.scope(f.context());
      expect(frozen.stopped!.callbacks.every((row) => row.exited)).toBe(true);
      expect((await f.run('stop', 3)).kind).toBe('done'); expect(f.stopCalls()).toBe(2);
      f.grant('stop', 3);
      await expect(f.owner.run(f.context('stop', 2))).rejects.toMatchObject({ kind: 'precondition' });
      await expect(f.owner.run({ ...f.context(), operationId: newResourceId() })).rejects.toMatchObject({ kind: 'precondition' });
      const [admission] = await f.database.db.execute<{ generation: number }>(sql`SELECT generation FROM task_runtime.project_admissions WHERE project_id=${f.project}`);
      expect(admission!.generation).toBe(3);
      expect((await f.repository.scope(f.context())).stopped).toEqual(frozen.stopped);
      f.permit(false); await expect(f.run('purge', 4)).rejects.toMatchObject({ kind: 'precondition' });
      expect((await f.database.db.execute<{ generation: number }>(sql`SELECT generation FROM task_runtime.project_admissions WHERE project_id=${f.project}`))[0]!.generation).toBe(3);
    } finally { await f.drop(); }
  });
  test('confirmation drift closes admission, keeps payload and allows a later original reconfirmation only', async () => {
    const f = await runtimeOwnerFixture(false);
    try {
      await f.environment();
      expect((await f.run('seal')).kind).toBe('blocked');
      await expectParentStorageRejection(f.environment(), 'permanently sealed');
      expect((await f.owner.inspect(f.target)).complete).toBe(true);
      const current = (await f.repository.inspect(f.target)).inventory;
      await expect(f.owner.run({ ...f.context(), confirmed: current })).rejects.toMatchObject({ kind: 'precondition' });
      f.grant('seal', 2); expect((await f.owner.run({ ...f.context(), confirmed: current })).kind).toBe('done');
      expect((await f.database.db.execute(sql`SELECT id FROM task_runtime.environments WHERE project_id=${f.project}`))).toHaveLength(2);
    } finally { await f.drop(); }
  });
  test('original payload CAS rejects historical corruption; later granted cleanup callbacks are collected in the atomic metadata proof', async () => {
    const f = await runtimeOwnerFixture();
    try {
      await f.through('namespace');
      f.grant('purge'); await f.work.runGranted(f.context(), f.rootInput, async () => undefined);
      await expect(f.work.runGranted(f.context('stop'), f.rootInput, async () => undefined)).rejects.toMatchObject({ kind: 'precondition' });
      const stopped = (await f.repository.scope(f.context())).stopped!, callbacks = await f.work.history(f.project);
      expect(callbacks.length).toBeGreaterThan(stopped.callbacks.length);
      await corruptRuntimeContent(f, 'environments', () => f.database.db.execute(sql`UPDATE task_runtime.environments SET message='historical-corruption' WHERE id=${f.parent}`));
      await expect(f.run('metadata')).rejects.toMatchObject({ kind: 'precondition' });
      expect((await f.database.db.execute(sql`SELECT id FROM task_runtime.environments WHERE id=${f.parent}`))).toHaveLength(1);
      expect((await f.work.history(f.project)).length).toBe(callbacks.length);
      await corruptRuntimeContent(f, 'environments', () => f.database.db.execute(sql`UPDATE task_runtime.environments SET message='controlled-original-stop' WHERE id=${f.parent}`));
      const result = await f.run('metadata'); expect(result.kind).toBe('done');
      if (result.kind !== 'done') throw new Error('original metadata did not complete');
      expect(result.evidence.count).toBe(stopped.count + callbacks.length - stopped.callbacks.length);
      expect(await f.run('metadata')).toEqual(result);
      expect((await f.repository.inspect(f.target)).scope.count).toBe(0);
      expect(result.evidence.digest).not.toBe(jsonHash('controlled-stop'));
    } finally { await f.drop(); }
  });
  test('a late row-delete failure rolls back the entire original inventory and metadata receipt', async () => {
    const f = await runtimeOwnerFixture();
    try {
      await f.through('namespace'); const before = await f.repository.inspect(f.target);
      await f.database.handle.client.unsafe(`CREATE FUNCTION task_runtime.fail_test_original_metadata() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF OLD.id='${f.parent}' THEN RAISE EXCEPTION 'controlled original metadata late failure';END IF;RETURN OLD;END $$;
        CREATE TRIGGER fail_test_original_metadata BEFORE DELETE ON task_runtime.environments FOR EACH ROW EXECUTE FUNCTION task_runtime.fail_test_original_metadata()`);
      await expectParentStorageRejection(f.run('metadata'), 'original metadata late failure');
      expect((await f.repository.inspect(f.target)).scope.contents).toEqual(before.scope.contents);
      expect((await f.database.db.execute<{ recorded: unknown }>(sql`SELECT phases->'metadata' AS recorded FROM task_runtime.project_deletions WHERE project_id=${f.project}`))[0]!.recorded).toBeNull();
      await f.database.db.execute(sql`DROP TRIGGER fail_test_original_metadata ON task_runtime.environments`);
      expect((await f.run('metadata')).kind).toBe('done');
      expect((await f.repository.inspect(f.target)).scope.count).toBe(0);
    } finally { await f.drop(); }
  });
  test('the original stop witness and stopped scope commit together; a renewed owner never repeats an acknowledged stop', async () => {
    const f = await runtimeOwnerFixture(false);
    try {
      await f.run('seal');
      await f.database.handle.client.unsafe(`CREATE FUNCTION task_runtime.require_test_stop_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF COALESCE(OLD.body->'stopped','null'::jsonb)='null'::jsonb AND COALESCE(NEW.body->'stopped','null'::jsonb)<>'null'::jsonb
        AND NOT NEW.phases ? 'stop' THEN RAISE EXCEPTION 'original stop witness absent from the snapshot commit';END IF;RETURN NEW;END $$;
        CREATE TRIGGER require_test_stop_commit BEFORE UPDATE ON task_runtime.project_deletions FOR EACH ROW EXECUTE FUNCTION task_runtime.require_test_stop_commit()`);
      const stopped = await f.run('stop'); expect(stopped.kind).toBe('done');
      const [row] = await f.database.db.execute<{ recorded: unknown; stopped: unknown }>(sql`
        SELECT phases->'stop' AS recorded,body->'stopped' AS stopped FROM task_runtime.project_deletions WHERE project_id=${f.project}`);
      expect(row!.stopped).not.toBeNull();
      if (stopped.kind !== 'done') throw new Error('original stop did not complete');
      expect(row!.recorded).toEqual(stopped.evidence); expect(stopped.evidence.digest).not.toBe(jsonHash('controlled-stop'));
      expect(await f.run('stop', 2)).toEqual(stopped); expect(f.stopCalls()).toBe(1);
    } finally { await f.drop(); }
  });
});
