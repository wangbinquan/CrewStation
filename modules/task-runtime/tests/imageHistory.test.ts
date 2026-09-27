import { afterEach, describe, expect, test } from 'bun:test';
import { newResourceId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { rebuildFixture } from './rebuildFixture';
const available = await testDatabaseAvailable();
let f: Awaited<ReturnType<typeof rebuildFixture>> | undefined;
afterEach(async () => { await f?.close(); f = undefined; });
describe.skipIf(!available)('环境镜像执行历史', () => {
  test('释放后仍由持久快照可查，项目与版本隔离且不混入验证环境', async () => {
    f = await rebuildFixture(); const versionId = newResourceId();
    const rows = await f.tdb.db.execute(sql`UPDATE task_runtime.environments SET state='released', render=${JSON.stringify({ runtimeImage: { versionId } })}::jsonb RETURNING id,project_id`);
    const row = rows[0]!; const query = { projectId: String(row.project_id), versionIds: [versionId], limit: 20 };
    expect(await f.runtime.api.imageHistory(query)).toEqual([expect.objectContaining({ id: row.id, versionId, kind: 'development', state: 'released', message: 'OOMKilled' })]);
    expect(await f.runtime.api.imageHistory({ ...query, before: String(row.id) })).toEqual([]);
    expect(await f.runtime.api.imageHistory({ ...query, projectId: newResourceId() })).toEqual([]);
    expect(await f.runtime.api.imageHistory({ ...query, versionIds: [newResourceId()] })).toEqual([]);
    expect(await f.runtime.api.imageHistory({ ...query, versionIds: [] })).toEqual([]);
    // Legacy native executions omitted purpose and remain CLI history, as in purposeOf.
    await f.tdb.db.execute(sql`UPDATE task_runtime.environments SET native=${JSON.stringify({ parentTaskId: row.id })}::jsonb`);
    expect(await f.runtime.api.imageHistory(query)).toEqual([expect.objectContaining({ kind: 'cli', parentTaskId: row.id })]);
    await f.tdb.db.execute(sql`UPDATE task_runtime.environments SET native=${JSON.stringify({ parentTaskId: row.id, purpose: 'business-agent' })}::jsonb`);
    expect(await f.runtime.api.imageHistory(query)).toEqual([expect.objectContaining({ kind: 'agent' })]);
    await f.tdb.db.execute(sql`UPDATE task_runtime.environments SET kind='profile-test'`);
    expect(await f.runtime.api.imageHistory(query)).toEqual([]);
  });
});
