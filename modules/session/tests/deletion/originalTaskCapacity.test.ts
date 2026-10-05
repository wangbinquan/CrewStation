import { describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { jsonHash } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { readOriginalSessionTasks } from '../../adapters/persistence/deletion/scopeTasks';
import { sessionDeletionFixture } from './fixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('original task directory capacity (real PostgreSQL; controlled sealed ownership)', () => {
  test('more than 65535 retained original keys reach the last real task; an omitted or foreign origin still blocks', async () => {
    const f = await sessionDeletionFixture();
    try {
      const task = f.task(), keys = [...Array.from({ length: 70_000 }, (_, i) => 'original-key-' + String(i).padStart(6, '0')), task];
      const revision = f.origins.get(task)!.revision;
      // Seed each controlled source through the actual immutable origin guard, without disabling it.
      await f.database.db.execute(sql`CREATE FUNCTION pg_temp.seed_original(key text,id text,project text,revision text) RETURNS boolean LANGUAGE plpgsql AS $$ BEGIN
        PERFORM set_config('crewstation.session_origin',session.digest(jsonb_build_object('key',key,'id',id,'projectId',project,'identity',revision)),true);
        INSERT INTO session.task_origins(task_key,task_id,project_id,identity) VALUES(key,id,project,revision); RETURN true; END $$`);
      await f.database.db.execute(sql`SELECT pg_temp.seed_original(key,${task},${f.projectId},${revision}) FROM jsonb_array_elements_text(${JSON.stringify(keys)}::jsonb) item(key)`);
      const scope = { taskKeys: keys, births: [], digest: jsonHash(keys), count: keys.length, compacted: false };
      // The old selector allocates one SQL parameter per key and fails before it can inspect the last original row.
      expect(await readOriginalSessionTasks(f.database.db, f.projectId, scope, null)).toEqual([task]);
      expect(await readOriginalSessionTasks(f.database.db, f.projectId, scope, task)).toEqual([]);
      await expect(readOriginalSessionTasks(f.database.db, f.projectId, { ...scope, taskKeys: [...keys, 'missing-original'] }, null)).rejects.toThrow('不完整');
      await expect(readOriginalSessionTasks(f.database.db, f.otherProject, scope, null)).rejects.toThrow('归属变化');
      expect((await f.database.db.execute<{ count: string }>(sql`SELECT count(*)::text AS count FROM session.task_origins`))[0]?.count).toBe(String(keys.length));
    } finally { await f.drop(); }
  }, 15_000);
});
