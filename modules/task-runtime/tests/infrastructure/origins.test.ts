import { describe, expect, test } from 'bun:test';
import { BUILTIN_RESOURCES, TaskIdSchema } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { resourceIdentityDirectory } from '@crewstation/persistence';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { taskRuntimeMigrations } from '../../wiring';
import { rebuildFixture } from '../rebuildFixture';
import { developmentParentEndingStorageFixture } from '../developmentParentEndingStorageFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('runtime infrastructure ownership (actual PG, not physical stopping)', () => {
  test('task and rebuild resolve their original project; private progress does not change the source', async () => {
    const f = await rebuildFixture();
    try {
      const input = await f.request(), accepted = await f.runtime.api.requestRebuild(f.projectId, input);
      const read = f.runtime.api.originalInfrastructureOwnership;
      const task = await read('task', f.env.id), rebuild = await read('rebuild', accepted.id);
      expect(task).toMatchObject({ id: f.env.id, scope: 'project', projectIds: [f.projectId] });
      expect(rebuild).toMatchObject({ id: accepted.id, scope: 'project', projectIds: [f.projectId] });
      const directory = resourceIdentityDirectory(f.tdb.db, () => [taskRuntimeMigrations]);
      await directory.bind('task_runtime', 'rebuild', ['private-old-rebuild'], accepted.id);
      expect(await read('rebuild', 'private-old-rebuild', 'legacy')).toEqual(rebuild);
      expect(await read('task', f.env.id, 'legacy')).toEqual(task);
      expect(await read('rebuild', newResourceId())).toBeUndefined();
      expect(await read('rebuild', 'unknown', 'legacy')).toBeUndefined();
      await expect(read('task', f.env.id, 'invalid' as never)).rejects.toThrow('未登记');
      await expect(read('invalid' as never, f.env.id)).rejects.toThrow('未登记');
      for (const secret of ['original-checkout', 'CS_DATABASE_URL', 'input', 'render', 'runnerToken', 'private-old-rebuild']) expect(JSON.stringify([task, rebuild])).not.toContain(secret);
      await f.tdb.db.execute(sql`UPDATE task_runtime.environment_rebuilds SET message='private failure' WHERE id=${accepted.id}`);
      expect(await read('rebuild', accepted.id)).toEqual(rebuild);
      await f.tdb.db.execute(sql`UPDATE task_runtime.environment_rebuilds SET project_id=${newResourceId()} WHERE id=${accepted.id}`);
      await expect(read('rebuild', accepted.id)).rejects.toThrow('归属冲突');
    } finally { await f.close(); }
  });
  test('parent ending uses the immutable original epoch and excludes its cleanup contents', async () => {
    const f = await developmentParentEndingStorageFixture();
    try {
      const [childId] = await f.seed(1);
      expect(await f.runtime.api.originalInfrastructureOwnership('task', childId!)).toMatchObject({ id: childId, projectIds: [f.projectId] });
      const ending = await f.admit();
      const origin = await f.runtime.api.originalInfrastructureOwnership('parent-ending', ending.id);
      expect(origin).toMatchObject({ id: ending.id, scope: 'project', projectIds: [f.projectId] });
      expect(await f.runtime.api.originalInfrastructureOwnership('parent-ending', ending.id, 'legacy')).toEqual(origin);
      expect(await f.runtime.api.originalInfrastructureOwnership('parent-ending', newResourceId())).toBeUndefined();
      expect(await f.runtime.api.originalInfrastructureOwnership('parent-ending', 'unknown-parent-ending', 'legacy')).toBeUndefined();
      await f.move(ending.id, 'children');
      expect(await f.runtime.api.originalInfrastructureOwnership('parent-ending', ending.id)).toEqual(origin);
      for (const field of ['epoch', 'selectionHash', 'progress', 'acceptedRender', 'completionWitness']) expect(JSON.stringify(origin)).not.toContain(field);
      // Corrupt only this isolated fixture; a mismatched original epoch must fail closed.
      await f.db.execute(sql`ALTER TABLE task_runtime.development_parent_endings DISABLE TRIGGER ALL`);
      await f.db.execute(sql`UPDATE task_runtime.development_parent_endings SET epoch_hash=${'0'.repeat(64)} WHERE id=${ending.id}`);
      await expect(f.runtime.api.originalInfrastructureOwnership('parent-ending', ending.id)).rejects.toThrow('受理范围冲突');
    } finally { await f.tdb.drop(); }
  });
  test('platform tests require their explicit sentinel identity; project image validations keep the actual project', async () => {
    const f = await rebuildFixture();
    try {
      const id = TaskIdSchema.parse(newResourceId());
      const columns = await f.tdb.db.execute<{ column_name: string }>(sql`SELECT column_name FROM information_schema.columns WHERE table_schema='task_runtime'
        AND table_name='environments' AND is_generated='NEVER' ORDER BY ordinal_position`);
      const names = sql.join(columns.map((c) => sql.identifier(c.column_name)),sql`, `), values = sql.join(columns.map((c) => sql`copy.${sql.identifier(c.column_name)}`),sql`, `);
      await f.tdb.db.execute(sql`INSERT INTO task_runtime.environments(${names}) SELECT ${values} FROM task_runtime.environments original
        CROSS JOIN LATERAL jsonb_populate_record(NULL::task_runtime.environments,to_jsonb(original)||jsonb_build_object('id',${id}::text,
          'kind','profile-test','project_id',${BUILTIN_RESOURCES.profileTestProject}::text,'service_id',${BUILTIN_RESOURCES.profileTestService}::text,
          'native',NULL,'render',NULL,'pod_name','platform-origin-test')) copy WHERE original.id=${f.env.id}`);
      const read = () => f.runtime.api.originalInfrastructureOwnership('task',id);
      expect(await read()).toMatchObject({ scope:'platform',projectIds:[] });
      expect(await f.runtime.api.originalProjectTaskIds(f.projectId, null)).not.toContain(id);
      await f.tdb.db.execute(sql`UPDATE task_runtime.environments SET render=jsonb_build_object('runtimeValidation',jsonb_build_object('projectId',${f.projectId}::text)) WHERE id=${id}`);
      expect(await read()).toMatchObject({ scope:'project',projectIds:[f.projectId] });
      expect(await f.runtime.api.originalProjectTaskIds(f.projectId, null)).toContain(id);
      await f.tdb.db.execute(sql`UPDATE task_runtime.environments SET render='{"runtimeValidation":{}}' WHERE id=${id}`);
      await expect(read()).rejects.toThrow();
      await f.tdb.db.execute(sql`UPDATE task_runtime.environments SET service_id=${f.serviceId} WHERE id=${id}`);
      await expect(read()).rejects.toThrow('原范围冲突');
    } finally { await f.close(); }
  });
  test('original project task pages traverse every historical native child and return a real EOF after the final page', async () => {
    const f = await developmentParentEndingStorageFixture();
    try {
      const children = await f.seed(205), found = [];
      let after: string | null = null;
      for (;;) {
        const page = await f.runtime.api.originalProjectTaskIds(f.projectId, after);
        if (!page.length) break;
        expect(page.length).toBeLessThanOrEqual(200); expect([...page]).toEqual([...page].sort());
        if (after) expect(page[0]! > after).toBe(true);
        found.push(...page); after = page.at(-1)!;
      }
      expect(new Set(found).size).toBe(found.length);
      for (const child of children) expect(found).toContain(child);
      expect(found).toHaveLength(206);
    } finally { await f.tdb.drop(); }
  }, 30_000);
});
