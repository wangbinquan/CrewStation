import { describe, expect, test } from 'bun:test';
import { BUILTIN_RESOURCES, TaskIdSchema } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { resourceIdentityDirectory } from '@crewstation/persistence';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { taskRuntimeMigrations } from '../../wiring';
import { rebuildFixture } from '../rebuildFixture';
import { corruptRuntimeContent } from '../deletion/contentFixture';

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
      await corruptRuntimeContent({ database: f.tdb }, 'environment_rebuilds', () => f.tdb.db.execute(sql`UPDATE task_runtime.environment_rebuilds SET project_id=${newResourceId()} WHERE id=${accepted.id}`));
      await expect(read('rebuild', accepted.id)).rejects.toThrow('归属冲突');
    } finally { await f.close(); }
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
      await corruptRuntimeContent({ database: f.tdb }, 'environments', () => f.tdb.db.execute(sql`UPDATE task_runtime.environments SET render=jsonb_build_object('runtimeValidation',jsonb_build_object('projectId',${f.projectId}::text)) WHERE id=${id}`));
      expect(await read()).toMatchObject({ scope:'project',projectIds:[f.projectId] });
      expect(await f.runtime.api.originalProjectTaskIds(f.projectId, null)).toContain(id);
      await corruptRuntimeContent({ database: f.tdb }, 'environments', () => f.tdb.db.execute(sql`UPDATE task_runtime.environments SET render='{"runtimeValidation":{}}' WHERE id=${id}`));
      await expect(read()).rejects.toThrow();
      await f.tdb.db.execute(sql`UPDATE task_runtime.environments SET service_id=${f.serviceId} WHERE id=${id}`);
      await expect(read()).rejects.toThrow('原范围冲突');
    } finally { await f.close(); }
  });
  test('original project task pages traverse every historical environment and return a real EOF after the final page', async () => {
    const f = await rebuildFixture();
    try {
      const ids = Array.from({ length: 205 }, () => TaskIdSchema.parse(newResourceId()));
      const columns = await f.tdb.db.execute<{ column_name: string }>(sql`SELECT column_name FROM information_schema.columns
        WHERE table_schema='task_runtime' AND table_name='environments' AND is_generated='NEVER' ORDER BY ordinal_position`);
      const names = sql.join(columns.map((c) => sql.identifier(c.column_name)), sql`, `);
      const values = sql.join(columns.map((c) => sql`copy.${sql.identifier(c.column_name)}`), sql`, `);
      await f.tdb.db.execute(sql`INSERT INTO task_runtime.environments (${names}) SELECT ${values} FROM task_runtime.environments original
        CROSS JOIN jsonb_array_elements(${JSON.stringify(ids)}::jsonb) item
        CROSS JOIN LATERAL jsonb_populate_record(NULL::task_runtime.environments, to_jsonb(original)||jsonb_build_object(
          'id',item#>>'{}','pod_name','original-copy-'||(item#>>'{}'))) copy WHERE original.id=${f.env.id}`);
      const found: string[] = [];
      let after: string | null = null;
      for (;;) {
        const page: readonly string[] = await f.runtime.api.originalProjectTaskIds(f.projectId, after);
        if (!page.length) break;
        expect(page.length).toBeLessThanOrEqual(200); expect([...page]).toEqual([...page].sort());
        if (after) expect(page[0]! > after).toBe(true);
        found.push(...page); after = page.at(-1)!;
      }
      expect(new Set(found).size).toBe(found.length);
      for (const id of [f.env.id, ...ids]) expect(found).toContain(id);
      expect(found).toHaveLength(206);
    } finally { await f.close(); }
  }, 30_000);
});
