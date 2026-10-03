import { describe, expect, test } from 'bun:test';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { withExclusiveDatabaseAdmission, withSharedDatabaseAdmission } from '@crewstation/persistence';
import { seedRuntimeContent } from './contentFixture';
import { runtimeWorkFixture } from './workFixture';
import { expectParentStorageRejection } from '../developmentParentEndingStorageFixture';
import { RUNTIME_CONTENT } from '../../adapters/persistence/deletion/contentTables';
import { runtimeProjectAdmissionKey } from '../../adapters/persistence/deletion/projectWork';
import { jsonHash, newResourceId } from '@crewstation/kernel';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('TaskRuntime complete content write fence (actual PG; controlled original public ports)', () => {
  test('the original seal rejects writes to every payload table, keeps another project writable, and rejects all payload truncation', async () => {
    const f = await runtimeWorkFixture();
    try {
      const seeded = await seedRuntimeContent(f), db = f.database.db;
      await db.execute(sql`UPDATE task_runtime.environments SET message='ordinary-before-seal' WHERE id=${f.parent}`);
      await f.seal();
      const updates = [
        sql`UPDATE task_runtime.environments SET message='late' WHERE id=${f.parent}`,
        sql`UPDATE task_runtime.admissions SET running=running+1 WHERE project_id=${f.project}`,
        sql`UPDATE task_runtime.environment_rebuilds SET message='late' WHERE id=${seeded.rebuild}`,
        sql`UPDATE task_runtime.blocked_admissions SET blocked_at=clock_timestamp() WHERE task_id=${seeded.reserved}`,
        sql`UPDATE task_runtime.archive_executions SET body=body||'{"late":true}'::jsonb WHERE id=${seeded.archive}`,
        sql`UPDATE task_runtime.unprovisioned_storage SET body=body||'{"late":true}'::jsonb WHERE task_id=${seeded.reserved}`,
        sql`UPDATE task_runtime.development_parent_endings SET message='late' WHERE id=${seeded.ending}`,
        sql`UPDATE task_runtime.development_parent_ending_children SET snapshot=snapshot WHERE ending_id=${seeded.ending}`,
        sql`UPDATE task_runtime.development_parent_ending_objects SET absence=absence WHERE ending_id=${seeded.ending}`,
        sql`UPDATE task_runtime.development_parent_rebuild_claims SET retry_at=clock_timestamp() WHERE source_ending_id=${seeded.ending}`,
      ];
      expect(updates.length).toBe(RUNTIME_CONTENT.length - 1);
      for (const update of updates) await expectParentStorageRejection(db.execute(update), 'Runtime project content admission is permanently sealed');
      await db.execute(sql`UPDATE task_runtime.environments SET message='other-project-still-writable' WHERE id=${f.otherParent}`);
      const [other] = await db.execute<{ message: string }>(sql`SELECT message FROM task_runtime.environments WHERE id=${f.otherParent}`);
      expect(other!.message).toBe('other-project-still-writable');
      for (const entry of RUNTIME_CONTENT) await expectParentStorageRejection(db.execute(sql`TRUNCATE ${sql.raw('task_runtime.' + entry.table)} CASCADE`), 'cannot be truncated');
    } finally { await f.drop(); }
  });
  test('ordinary SQL cannot replace original task, service, parent or body links or rebind a purged original key', async () => {
    const f = await runtimeWorkFixture();
    try {
      const seeded = await seedRuntimeContent(f), db = f.database.db;
      for (const change of [sql`UPDATE task_runtime.environments SET service_id=${f.otherService} WHERE id=${seeded.child}`,
        sql`UPDATE task_runtime.environments SET native=jsonb_set(native,'{parentTaskId}',to_jsonb(${f.otherParent}::text)) WHERE id=${seeded.child}`,
        sql`UPDATE task_runtime.archive_executions SET body=jsonb_set(body,'{taskId}',to_jsonb(${f.otherParent}::text)) WHERE id=${seeded.archive}`])
        await expectParentStorageRejection(db.execute(change), 'original project service task and parent links cannot be replaced');
      await f.work.run(f.input(), async () => undefined);
      await db.execute(sql`DELETE FROM task_runtime.environments WHERE id=${f.parent}`);
      await expectParentStorageRejection(f.environment({ id: f.parent, projectId: f.otherProject, serviceId: f.otherService }), 'original content project links conflict');
    } finally { await f.drop(); }
  });
  test('only a live current stop callback can write old lifecycle state; a shared lock alone or another phase cannot, and stop cannot create an environment', async () => {
    const f = await runtimeWorkFixture();
    try {
      await f.work.run(f.input(), async () => undefined); await f.seal();
      const update = () => f.database.db.transaction((tx) => tx.execute(sql`UPDATE task_runtime.environments SET message='original-stop' WHERE id=${f.parent}`));
      await expectParentStorageRejection(withSharedDatabaseAdmission(f.database.db, runtimeProjectAdmissionKey(f.project), update), 'permanently sealed');
      const context = await f.context('stop'), input = { originKind: 'task' as const, originKey: f.parent, reference: f.input().reference, inputDigest: f.input().inputDigest };
      await f.work.runGranted(context, input, async () => {
        await update(); await expectParentStorageRejection(f.environment(), 'permanently sealed');
      });
      await expectParentStorageRejection(f.work.runGranted(await f.context('purge'), input, update), 'permanently sealed');
      expect((await f.work.history(f.project)).every((row) => row.exited)).toBe(true);
      const [row] = await f.database.db.execute<{ message: string }>(sql`SELECT message FROM task_runtime.environments WHERE id=${f.parent}`);
      expect(row!.message).toBe('original-stop');
    } finally { await f.drop(); }
  });
  test('the stopped snapshot keeps the original confirmation and accepts exactly one complete current stop inventory', async () => {
    const f = await runtimeWorkFixture();
    try {
      await f.work.run(f.input(), async () => undefined); await f.seal();
      const context = await f.context('stop'), current = await f.inspect(), db = f.database.db;
      const callbacks = await f.work.history(f.project), contents = current.contents;
      const body = { contents, callbacks, count: contents.length, digest: current.traversal.digest, compacted: false, stopped: null };
      const stopped = { contents, callbacks, count: contents.length, digest: jsonHash({ contents, callbacks }) };
      const write = (phase: string, snapshot: unknown) => withExclusiveDatabaseAdmission(db, runtimeProjectAdmissionKey(f.project), async (tx) => {
        await tx.execute(sql`SELECT set_config('crewstation.task_runtime_deletion',${context.operationId + ':' + context.generation + ':' + phase},true)`);
        await tx.execute(sql`UPDATE task_runtime.project_deletions SET body=body||jsonb_build_object('stopped',${JSON.stringify(snapshot)}::jsonb) WHERE project_id=${f.project}`);
      });
      await withExclusiveDatabaseAdmission(db, runtimeProjectAdmissionKey(f.project), async (tx) => {
        await tx.execute(sql`SELECT set_config('crewstation.task_runtime_deletion',${context.operationId + ':' + context.generation + ':seal'},true)`);
        await tx.execute(sql`INSERT INTO task_runtime.project_deletions(project_id,operation_id,generation,revision,body,verified)
          VALUES(${f.project},${context.operationId},${context.generation},${context.confirmed.revision},${JSON.stringify(body)}::jsonb,true)`);
      });
      for (const invalid of [{ ...stopped, digest: '0'.repeat(64) }, { ...stopped, count: stopped.count + 1 }, { ...stopped, extra: true }])
        await expectParentStorageRejection(write('stop', invalid), 'frozen original content cannot be replaced');
      await expectParentStorageRejection(write('purge', stopped), 'frozen original content cannot be replaced');
      await write('stop', stopped); await write('stop', stopped);
      const [saved] = await db.execute<{ body: Omit<typeof body, 'stopped'> & { stopped: typeof stopped } }>(sql`SELECT body FROM task_runtime.project_deletions WHERE project_id=${f.project}`);
      expect(saved!.body.contents).toEqual(contents); expect(saved!.body.callbacks).toEqual(callbacks);
      expect(saved!.body.digest).toBe(body.digest); expect(saved!.body.stopped).toEqual(stopped);
      const replacement = { contents: [], callbacks: [], count: 0, digest: jsonHash({ contents: [], callbacks: [] }) };
      await expectParentStorageRejection(write('stop', replacement), 'frozen original content cannot be replaced');
      await expectParentStorageRejection(db.execute(sql`UPDATE task_runtime.project_deletions SET body=body||'{"compacted":true}'::jsonb WHERE project_id=${f.project}`), 'original exclusive grant');
    } finally { await f.drop(); }
  });
  test('metadata requires the original exclusive operation, namespace proof and exited callbacks; fixed members then clear while minimum origins and closure remain', async () => {
    const f = await runtimeWorkFixture();
    try {
      const seeded = await seedRuntimeContent(f), db = f.database.db;
      await f.work.run(f.input(), async () => undefined);
      await f.work.runOrigin({ originKind: 'service', originKey: f.service, kind: 'service-api', reference: f.input().reference, inputDigest: f.input().inputDigest }, async () => undefined);
      await withSharedDatabaseAdmission(db, runtimeProjectAdmissionKey(f.project), async (guard) => {
        const pid = (await guard.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`))[0]!.pid;
        await db.transaction((tx) => tx.execute(sql`INSERT INTO task_runtime.original_callbacks
          (id,project_id,origin_kind,origin_key,origin_id,kind,reference,consumer_id,input_digest,origin_revision,backend_pid,original_process,exit_key_hash)
          SELECT ${newResourceId()},project_id,origin_kind,origin_key,origin_id,kind,${newResourceId()},${newResourceId()},input_digest,origin_revision,${pid},original_process,exit_key_hash
          FROM task_runtime.original_callbacks WHERE project_id=${f.project} LIMIT 1`));
      });
      await f.seal(); const context = await f.context('metadata'), grant = context.operationId + ':' + context.generation;
      await expectParentStorageRejection(db.execute(sql`DELETE FROM task_runtime.original_callbacks`), 'completed metadata owner');
      await expectParentStorageRejection(db.execute(sql`DELETE FROM task_runtime.development_parent_ending_children WHERE ending_id=${seeded.ending}`), 'fixed membership cannot change');
      await withExclusiveDatabaseAdmission(db, runtimeProjectAdmissionKey(f.project), async (tx) => {
        await tx.execute(sql`SELECT set_config('crewstation.task_runtime_deletion',${grant + ':seal'},true)`);
        await tx.execute(sql`INSERT INTO task_runtime.project_deletions(project_id,operation_id,generation,revision,body,verified)
          VALUES(${f.project},${context.operationId},${context.generation},${context.confirmed.revision},'{"contents":[],"callbacks":[],"compacted":false}'::jsonb,true)`);
      });
      const remove = () => withExclusiveDatabaseAdmission(db, runtimeProjectAdmissionKey(f.project), async (tx) => {
        await tx.execute(sql`SELECT set_config('crewstation.task_runtime_deletion',${grant + ':metadata'},true)`);
        await tx.execute(sql`DELETE FROM task_runtime.original_callbacks WHERE project_id=${f.project}`);
      });
      await expectParentStorageRejection(remove(), 'completed metadata owner');
      await withExclusiveDatabaseAdmission(db, runtimeProjectAdmissionKey(f.project), async (tx) => {
        await tx.execute(sql`SELECT set_config('crewstation.task_runtime_deletion',${grant + ':namespace'},true)`);
        await tx.execute(sql`UPDATE task_runtime.project_deletions SET phases='{"namespace":{"controlled":"namespace-proof"}}'::jsonb WHERE project_id=${f.project}`);
      });
      await expectParentStorageRejection(remove(), 'completed metadata owner');
      const pendingSnapshot = { contents: [], callbacks: [], count: 0, digest: jsonHash({ contents: [], callbacks: [] }) };
      await expectParentStorageRejection(withExclusiveDatabaseAdmission(db, runtimeProjectAdmissionKey(f.project), async (tx) => {
        await tx.execute(sql`SELECT set_config('crewstation.task_runtime_deletion',${grant + ':stop'},true)`);
        await tx.execute(sql`UPDATE task_runtime.project_deletions SET body=body||jsonb_build_object('stopped',${JSON.stringify(pendingSnapshot)}::jsonb) WHERE project_id=${f.project}`);
      }), 'frozen original content cannot be replaced');
      f.stopped(true); await f.work.observe(); expect((await f.work.history(f.project)).every((row) => row.exited)).toBe(true);
      for (const wrong of [context.operationId + ':2:metadata', newResourceId() + ':1:metadata'])
        await expectParentStorageRejection(withExclusiveDatabaseAdmission(db, runtimeProjectAdmissionKey(f.project), async (tx) => {
          await tx.execute(sql`SELECT set_config('crewstation.task_runtime_deletion',${wrong},true)`);
          await tx.execute(sql`DELETE FROM task_runtime.original_callbacks WHERE project_id=${f.project}`);
        }), 'completed metadata owner');
      await withExclusiveDatabaseAdmission(db, runtimeProjectAdmissionKey(f.project), async (tx) => {
        await tx.execute(sql`SELECT set_config('crewstation.task_runtime_deletion',${grant + ':metadata'},true)`);
        await tx.execute(sql`DELETE FROM task_runtime.original_callbacks WHERE project_id=${f.project}`);
        await tx.execute(sql`DELETE FROM task_runtime.development_parent_ending_children WHERE ending_id=${seeded.ending}`);
        await tx.execute(sql`DELETE FROM task_runtime.environments WHERE id=${f.parent}`);
      });
      expect(await f.work.history(f.project)).toEqual([]);
      expect((await db.execute(sql`SELECT id FROM task_runtime.environments WHERE id=${f.otherParent}`))).toHaveLength(1);
      await expectParentStorageRejection(f.environment({ id: f.parent }), 'permanently sealed');
      await expectParentStorageRejection(db.execute(sql`DELETE FROM task_runtime.project_deletions`), 'tombstone cannot be removed');
      await expectParentStorageRejection(db.execute(sql`DELETE FROM task_runtime.project_admissions`), 'original exclusive deletion grant');
      await expectParentStorageRejection(db.execute(sql`DELETE FROM task_runtime.work_origins`), 'original identity cannot be rewritten or deleted');
    } finally { await f.drop(); }
  });
});
