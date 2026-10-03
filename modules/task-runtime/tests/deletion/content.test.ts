import { describe, expect, test } from 'bun:test';
import { BUILTIN_RESOURCES } from '@crewstation/contracts';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { resourceIdentityDirectory } from '@crewstation/persistence';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { RUNTIME_CONTENT } from '../../adapters/persistence/deletion/contentTables';
import { taskRuntimeMigrations } from '../../wiring';
import { developmentParentEpochHash } from '../../domain/development/parentEnding';
import { runtimeContentFixture, seedRuntimeContent } from './contentFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('TaskRuntime content inventory (actual read-only PG; controlled original public identities)', () => {
  test('traverses every payload family to EOF, accounts for legacy columns, excludes foreign history and exports no content', async () => {
    const f = await runtimeContentFixture();
    try {
      const seeded = await seedRuntimeContent(f), ids = Array.from({ length: 205 }, () => newResourceId());
      const columns = await f.database.db.execute<{ column_name: string }>(sql`SELECT column_name FROM information_schema.columns
        WHERE table_schema='task_runtime' AND table_name='environments' AND is_generated='NEVER' ORDER BY ordinal_position`);
      const names = sql.join(columns.map((row) => sql.identifier(row.column_name)), sql`, `), values = sql.join(columns.map((row) => sql`copy.${sql.identifier(row.column_name)}`), sql`, `);
      await f.database.db.execute(sql`INSERT INTO task_runtime.environments(${names}) SELECT ${values} FROM task_runtime.environments original
        CROSS JOIN jsonb_array_elements(${JSON.stringify(ids)}::jsonb) item
        CROSS JOIN LATERAL jsonb_populate_record(NULL::task_runtime.environments,to_jsonb(original)||jsonb_build_object('id',item#>>'{}','pod_name',item#>>'{}')) copy WHERE original.id=${f.parent}`);
      const before = await f.database.db.execute('SELECT id,runner_token_hash,render,message FROM task_runtime.environments ORDER BY id');
      const result = await f.inspect();
      expect(RUNTIME_CONTENT).toHaveLength(11); expect(result.inventory.complete).toBe(true); expect(result.inventory.resources).toHaveLength(10);
      expect(result.traversal.counts.environments).toBe(209); expect(result.inventory.resources.find((row) => row.id === 'environments')?.count).toBe(208);
      expect(result.contents).toHaveLength(217); expect(result.contents.some((row) => row.key.includes(f.otherParent))).toBe(false);
      expect(result.origins.find((row) => row.kind === 'task' && row.key === seeded.reserved)?.projectId).toBe(f.project);
      for (const secret of ['runner_token_hash', '111111111111', 'original-rebuild-input', 'original-stop-intent', 'original-numeric-tail', 'archive-private-DSN', 'never-provisioned-private'])
        expect(JSON.stringify(result)).not.toContain(secret);
      expect(f.requests.filter((row) => row === 'service:' + f.service + ':current')).toHaveLength(1);
      expect(await f.database.db.execute('SELECT id,runner_token_hash,render,message FROM task_runtime.environments ORDER BY id')).toEqual(before);
      expect(await f.inspect()).toEqual(result);
      await f.database.db.execute(sql`UPDATE task_runtime.environments SET message='private changed at last page' WHERE id=${ids[204]!}`);
      expect((await f.inspect()).inventory.revision).not.toBe(result.inventory.revision);
    } finally { await f.database.drop(); }
  }, 20000);

  test('a never-provisioned task needs its actual accepted business owner and cannot be inferred from a service or body', async () => {
    const f = await runtimeContentFixture();
    try {
      const { reserved } = await seedRuntimeContent(f);
      f.origins.delete('business-task:' + reserved); await expect(f.inspect()).rejects.toThrow('原任务来源缺失');
      f.bind('business-task', reserved, f.otherProject); await expect(f.inspect()).rejects.toThrow('归属冲突');
      f.bind('business-task', reserved); f.unavailable.add('business-task:' + reserved); await expect(f.inspect()).rejects.toThrow('source offline');
      f.unavailable.clear(); expect((await f.inspect()).inventory.complete).toBe(true);
    } finally { await f.database.drop(); }
  });

  test('platform tests stay shared; an explicit project image validation belongs to the original project', async () => {
    const f = await runtimeContentFixture();
    try {
      const platform = { kind: 'profile-test', projectId: BUILTIN_RESOURCES.profileTestProject, serviceId: BUILTIN_RESOURCES.profileTestService };
      const shared = await f.environment(platform), validation = await f.environment({ ...platform, render: { runtimeValidation: { projectId: f.project } } });
      await f.database.db.execute(sql`INSERT INTO task_runtime.admissions(project_id,running) VALUES(${BUILTIN_RESOURCES.profileTestProject},0)`);
      const result = await f.inspect();
      expect(result.contents.some((row) => row.key.includes(validation))).toBe(true); expect(result.contents.some((row) => row.key.includes(shared))).toBe(false);
      expect(result.contents.some((row) => row.table === 'admissions')).toBe(false);
      await f.database.db.execute(sql`UPDATE task_runtime.environments SET render='{"runtimeValidation":null}' WHERE id=${validation}`);
      await expect(f.inspect()).rejects.toThrow('关系必须是对象');
      await f.database.db.execute(sql`UPDATE task_runtime.environments SET render=NULL,service_id=${f.service} WHERE id=${shared}`);
      await expect(f.inspect()).rejects.toThrow('原范围冲突');
    } finally { await f.database.drop(); }
  });

  test('explicit JSON null, missing tables, unknown columns or tables and conflicting UUID aliases block completeness', async () => {
    const f = await runtimeContentFixture();
    try {
      await f.database.db.execute(sql`UPDATE task_runtime.environments SET native='null'::jsonb WHERE id=${f.parent}`); await expect(f.inspect()).rejects.toThrow('显式无效');
      await f.database.db.execute(sql`UPDATE task_runtime.environments SET native=NULL WHERE id=${f.parent}`);
      await f.database.db.execute('CREATE TABLE task_runtime.unregistered_history(id text,payload jsonb)'); await expect(f.inspect()).rejects.toThrow('未登记');
      await f.database.db.execute('DROP TABLE task_runtime.unregistered_history'); await f.database.db.execute('ALTER TABLE task_runtime.admissions ADD COLUMN unexpected_payload jsonb');
      await expect(f.inspect()).rejects.toThrow('未登记变化'); await f.database.db.execute('ALTER TABLE task_runtime.admissions DROP COLUMN unexpected_payload');
      const directory = resourceIdentityDirectory(f.database.db, () => [taskRuntimeMigrations]);
      await directory.bind('task_runtime', 'task', [f.parent], newResourceId()); await expect(f.inspect()).rejects.toThrow('原标识目录冲突');
      await f.database.db.execute('DELETE FROM task_runtime.resource_identity_aliases'); await f.database.db.execute('DROP TABLE task_runtime.unprovisioned_storage');
      await expect(f.inspect()).rejects.toThrow('缺失');
    } finally { await f.database.drop(); }
  });

  test('native children and frozen parent members require their original workspace and all original identity links', async () => {
    const f = await runtimeContentFixture();
    try {
      const seeded = await seedRuntimeContent(f);
      await f.database.db.execute(sql`UPDATE task_runtime.environments SET service_id=${f.otherService} WHERE id=${seeded.child}`); await expect(f.inspect()).rejects.toThrow('归属冲突');
      await f.database.db.execute(sql`UPDATE task_runtime.environments SET service_id=${f.service},native=jsonb_set(native,'{parentTaskId}',to_jsonb(${f.otherParent}::text)) WHERE id=${seeded.child}`);
      await expect(f.inspect()).rejects.toThrow('父关系冲突');
      await f.database.db.execute(sql`UPDATE task_runtime.environments SET native=jsonb_set(native,'{parentTaskId}',to_jsonb(${f.parent}::text)) WHERE id=${seeded.child}`);
      await f.database.db.execute(sql`UPDATE task_runtime.environments SET native=jsonb_set(native,'{runnerId}',to_jsonb(${newResourceId()}::text)) WHERE id=${seeded.child}`);
      await expect(f.inspect()).rejects.toThrow('原父记录关系不符');
    } finally { await f.database.drop(); }
  });

  test('legacy task, agent and runner keys must resolve to the same original records', async () => {
    const f = await runtimeContentFixture();
    try {
      const current = f.native(), child = await f.environment({ native: current }), old = { ...current, parentTaskId: 'old-parent', agentId: 'old-agent', runnerId: 'old-runner' };
      await f.database.db.execute(sql`UPDATE task_runtime.environments SET legacy_cluster=${JSON.stringify({ taskId: 'old-child', native: old })}::jsonb,legacy_native=${JSON.stringify(old)}::jsonb WHERE id=${child}`);
      await expect(f.inspect()).rejects.toThrow('历史原身份不符');
      const directory = resourceIdentityDirectory(f.database.db, () => [taskRuntimeMigrations]);
      for (const [kind, key, id] of [['task', 'old-child', child], ['task', 'old-parent', f.parent], ['agent', 'old-agent', current.agentId], ['runner', 'old-runner', current.runnerId]])
        await directory.bind('task_runtime', kind!, [key!], id!);
      expect((await f.inspect()).inventory.resources[0]?.count).toBe(2);
      await f.database.db.execute(sql`UPDATE task_runtime.environments SET legacy_native=jsonb_set(legacy_native,'{agentId}',to_jsonb(${newResourceId()}::text)) WHERE id=${child}`);
      await expect(f.inspect()).rejects.toThrow('历史原身份不符');
    } finally { await f.database.drop(); }
  });

  test('replaced or shared public roots and stale recovery links cannot confirm private content', async () => {
    const f = await runtimeContentFixture();
    try {
      const seeded = await seedRuntimeContent(f), original = f.origins.get('service:' + f.service)!;
      f.origins.set('service:' + f.service, { ...original, id: newResourceId() }); await expect(f.inspect()).rejects.toThrow('当前 ID 不符');
      f.origins.set('service:' + f.service, { ...original, projectIds: [f.project, f.otherProject] }); await expect(f.inspect()).rejects.toThrow('共享');
      f.origins.set('service:' + f.service, original);
      await f.database.db.execute(sql`UPDATE task_runtime.environment_rebuilds SET input=jsonb_set(input,'{expectedTaskId}',to_jsonb(${f.otherParent}::text)) WHERE id=${seeded.rebuild}`);
      await expect(f.inspect()).rejects.toThrow('原任务关系不符');
    } finally { await f.database.drop(); }
  });

  test('current parent pointers and pending/completed rebuild bindings require the original epoch and completion hash', async () => {
    const f = await runtimeContentFixture();
    try {
      const seeded = await seedRuntimeContent(f), epochHash = developmentParentEpochHash(seeded.epoch);
      const pointer = { version: 1, endingId: seeded.ending, epochHash, phase: 'children' };
      const pending = { version: 1, endingId: seeded.ending, epochHash, kind: 'pending-ending' };
      await f.database.db.execute(sql`UPDATE task_runtime.environments SET parent_ending=${JSON.stringify(pointer)}::jsonb WHERE id=${f.parent}`);
      await f.database.db.execute(sql`UPDATE task_runtime.environment_rebuilds SET development_parent_binding=${JSON.stringify(pending)}::jsonb WHERE id=${seeded.rebuild}`);
      expect((await f.inspect()).inventory.complete).toBe(true);
      const witness = { private: 'completed-original-tail' };
      await f.database.db.execute(sql`UPDATE task_runtime.development_parent_endings SET phase='complete',status='complete',completion_witness=${JSON.stringify(witness)}::jsonb WHERE id=${seeded.ending}`);
      const completed = { ...pending, kind: 'completed-ending', completionWitnessHash: jsonHash(witness), afterTransitionHash: jsonHash('original-transition'), pvcUid: seeded.epoch.pvcUid, claimRevision: 1 };
      await f.database.db.execute(sql`UPDATE task_runtime.environment_rebuilds SET development_parent_binding=${JSON.stringify(completed)}::jsonb WHERE id=${seeded.rebuild}`);
      const inventory = await f.inspect(); expect(inventory.inventory.complete).toBe(true); expect(JSON.stringify(inventory)).not.toContain(witness.private);
      await f.database.db.execute(sql`UPDATE task_runtime.environment_rebuilds SET development_parent_binding=jsonb_set(development_parent_binding,'{completionWitnessHash}',to_jsonb(${'0'.repeat(64)}::text)) WHERE id=${seeded.rebuild}`);
      await expect(f.inspect()).rejects.toThrow('原完成证明不符');
    } finally { await f.database.drop(); }
  });

  test('legacy rebuild input and cluster identities must map to the same original task and request', async () => {
    const f = await runtimeContentFixture();
    try {
      const seeded = await seedRuntimeContent(f), directory = resourceIdentityDirectory(f.database.db, () => [taskRuntimeMigrations]);
      await f.database.db.execute(sql`UPDATE task_runtime.environment_rebuilds SET legacy_input='{"expectedTaskId":"old-parent"}'::jsonb,
        legacy_cluster='{"taskId":"old-parent","rebuildId":"old-rebuild"}'::jsonb WHERE id=${seeded.rebuild}`);
      await expect(f.inspect()).rejects.toThrow('历史原身份不符');
      await directory.bind('task_runtime', 'task', ['old-parent'], f.parent); await directory.bind('task_runtime', 'rebuild', ['old-rebuild'], seeded.rebuild);
      expect((await f.inspect()).inventory.complete).toBe(true);
      await f.database.db.execute(sql`UPDATE task_runtime.environment_rebuilds SET legacy_input=jsonb_set(legacy_input,'{expectedTaskId}',to_jsonb(${f.otherParent}::text)) WHERE id=${seeded.rebuild}`);
      await expect(f.inspect()).rejects.toThrow('历史原身份不符');
    } finally { await f.database.drop(); }
  });

  test('archive bodies, frozen membership counts and immutable epochs cannot borrow unrelated original records', async () => {
    const f = await runtimeContentFixture();
    try {
      const seeded = await seedRuntimeContent(f);
      await f.database.db.execute(sql`UPDATE task_runtime.archive_executions SET body=jsonb_set(body,'{taskId}',to_jsonb(${f.otherParent}::text)) WHERE id=${seeded.archive}`);
      await expect(f.inspect()).rejects.toThrow('原父记录关系不符');
      await f.database.db.execute(sql`UPDATE task_runtime.archive_executions SET body=jsonb_set(body,'{taskId}',to_jsonb(${seeded.business}::text)) WHERE id=${seeded.archive}`);
      // Only this isolated fixture is corrupted. Inspection must reject missing members even if the original table guard was lost.
      await f.database.db.execute('ALTER TABLE task_runtime.development_parent_endings DISABLE TRIGGER ALL');
      await f.database.db.execute(sql`UPDATE task_runtime.development_parent_endings SET member_count=2 WHERE id=${seeded.ending}`);
      await expect(f.inspect()).rejects.toThrow('冻结成员数');
      await f.database.db.execute(sql`UPDATE task_runtime.development_parent_endings SET member_count=1,epoch_hash=${'0'.repeat(64)} WHERE id=${seeded.ending}`);
      await expect(f.inspect()).rejects.toThrow('受理范围冲突');
    } finally { await f.database.drop(); }
  });

  test('missing and unavailable public project/service facts never produce an empty successful scope', async () => {
    const f = await runtimeContentFixture();
    try {
      f.unavailable.add('project:' + f.project); await expect(f.inspect()).rejects.toThrow('source offline'); f.unavailable.clear();
      const service = f.origins.get('service:' + f.service)!; f.origins.delete('service:' + f.service); await expect(f.inspect()).rejects.toThrow('服务来源缺失');
      f.origins.set('service:' + f.service, service); f.origins.set('project:' + f.project, { ...f.origins.get('project:' + f.project)!, projectIds: [f.otherProject] });
      await expect(f.inspect()).rejects.toThrow('原项目身份冲突');
    } finally { await f.database.drop(); }
  });
});
