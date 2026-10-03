// Actual owner prepare/frozen price and AgentStart rows, without model dispatch.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { newResourceId } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { readDevelopmentObservationFacts, readDevelopmentObservationTaskPage, readDevelopmentObservationAttemptPage, devSessionMigrations } from '../wiring';
import { developmentUsageFixture } from './developmentUsageFixture';

const available = await testDatabaseAvailable(); let tdb: TestDatabase;
const query = { from: '2026-09-30T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z', timezone: 'Asia/Shanghai' };
beforeAll(async () => { if (available) tdb = await createTestDatabase([devSessionMigrations]); });
afterEach(async () => { if (tdb) await tdb.db.execute(sql`TRUNCATE dev_session.development_agent_usage, dev_session.agent_starts CASCADE`); });
afterAll(async () => { await tdb?.drop(); });
async function accepted() { const f = await developmentUsageFixture(tdb.db); await f.starts.update({ ...f.start, computeName: 'Accepted Compute', createdAt: '2025-01-01T00:00:00.000Z' }); await f.owner.prepare(f.preparation); return f; }

describe.skipIf(!available)('development safe runtime owner facts', () => {
  test('cohort uses original price admission, safe fields and accepted compute name', async () => {
    const f = await accepted(), page = await readDevelopmentObservationFacts(tdb.db, query), task = page.items[0]!;
    expect(page.partial).toBe(false); expect(page.items).toHaveLength(1);
    expect(task).toMatchObject({ id: f.child.id, protocol: 'development', createdAt: '2026-09-30T00:10:01.000Z', closedAt: null,
      source: { kind: 'development-agent', identity: f.preparation.intent.identity, workspaceName: null } });
    expect(task.attempts[0]).toMatchObject({ taskId: f.workspace.id, id: f.start.agentId, profileName: 'Accepted Compute', profileRevision: 2, startedAt: null, endedAt: null });
    for (const secret of ['owner-private-prompt','/work','digestNonce','payloadDigest','binaryPath','configured-model','resumeSessionId']) expect(JSON.stringify(page)).not.toContain(secret);
    expect((await readDevelopmentObservationFacts(tdb.db, { ...query, sourceKind: 'business-task' })).items).toEqual([]);
    expect((await readDevelopmentObservationFacts(tdb.db, { ...query, projectId: newResourceId() })).items).toEqual([]);
    expect((await readDevelopmentObservationFacts(tdb.db, { ...query, from: '2025-01-01T00:00:00.000Z', to: '2025-01-02T00:00:00.000Z' })).items).toEqual([]);
    expect((await readDevelopmentObservationFacts(tdb.db, { ...query, taskId: f.child.id })).items).toHaveLength(1);
  });
  test('logical cancelled/ended timestamps do not become activity intervals', async () => {
    const f = await accepted(); await f.starts.update({ ...f.start, state: 'ended', cancelled: true, dispatchedAt: query.from, endedAt: query.to });
    await f.owner.close(f.child.id, 'cancelled');
    const task = (await readDevelopmentObservationFacts(tdb.db, { ...query, taskId: f.child.id })).items[0]!;
    expect(task.state).toBe('cancelled'); expect(task.closedAt).toBeNull(); expect(task.attempts[0]?.startedAt).toBeNull(); expect(task.attempts[0]?.endedAt).toBeNull();
  });
  test('a legacy Agent without original numeric admission remains outside the numeric cohort', async () => {
    await developmentUsageFixture(tdb.db); expect(await readDevelopmentObservationFacts(tdb.db, query)).toEqual({ items: [], partial: false });
  });
  test('mismatched Agent, workspace, profile and frozen price are rejected', async () => {
    const f = await accepted();
    for (const patch of [{ agentId: newResourceId() }, { taskId: newResourceId() }, { compute: newResourceId() }, { profile: { profileId: f.start.profile.profileId, revision: 99 } }]) {
      await tdb.db.execute(sql`UPDATE dev_session.agent_starts SET agent_id=${patch.agentId ?? f.start.agentId},task_id=${patch.taskId ?? f.start.taskId},compute=${patch.compute ?? f.start.compute},profile=${JSON.stringify(patch.profile ?? f.start.profile)}::jsonb WHERE execution_task_id=${f.child.id}`);
      await expect(readDevelopmentObservationFacts(tdb.db, { ...query, taskId: f.child.id })).rejects.toMatchObject({ kind: 'conflict' });
    }
    await tdb.db.execute(sql`UPDATE dev_session.agent_starts SET agent_id=${f.start.agentId},task_id=${f.start.taskId},compute=${f.start.compute},profile=${JSON.stringify(f.start.profile)}::jsonb WHERE execution_task_id=${f.child.id}`);
    await tdb.db.execute(sql`UPDATE dev_session.development_agent_usage SET prepared=jsonb_set(prepared,'{price,identity,agentId}',to_jsonb(${newResourceId()}::text)) WHERE execution_task_id=${f.child.id}`);
    await expect(readDevelopmentObservationFacts(tdb.db, query)).rejects.toMatchObject({ kind: 'conflict' });
  });
  test('bounds signal partial and independent detail remains readable beyond overview', async () => {
    let last = '';
    for (let n = 0; n < 201; n++) last = (await accepted()).child.id;
    const page = await readDevelopmentObservationFacts(tdb.db, query); expect(page.items).toHaveLength(200); expect(page.partial).toBe(true);
    const missing = await tdb.db.execute<{ execution_task_id: string }>(sql`SELECT execution_task_id FROM dev_session.development_agent_usage ORDER BY accepted_at::timestamptz DESC,execution_task_id OFFSET 200 LIMIT 1`);
    const detail = await readDevelopmentObservationFacts(tdb.db, { ...query, taskId: missing[0]!.execution_task_id }); expect(detail.items).toHaveLength(1); expect(detail.partial).toBe(false); expect(last).not.toBe('');
    const all: string[] = []; let after: string | undefined;
    do { const full = await readDevelopmentObservationTaskPage(tdb.db, { ...query, pageSize: 37, ...(after === undefined ? {} : { after }) }); all.push(...full.items.map((row) => row.id)); after = full.nextCursor ?? undefined; } while (after !== undefined);
    const originals = await tdb.db.execute<{ execution_task_id: string }>(sql`SELECT execution_task_id FROM dev_session.development_agent_usage ORDER BY accepted_at::timestamptz DESC, execution_task_id`);
    expect(all).toEqual(originals.map((row) => row.execution_task_id)); expect(new Set(all).size).toBe(201);
    const attempt = await readDevelopmentObservationAttemptPage(tdb.db, { ...query, taskId: missing[0]!.execution_task_id, pageSize: 37 });
    expect(attempt.nextCursor).toBeNull(); expect(attempt.items).toEqual(detail.items[0]!.attempts);
    const first = await readDevelopmentObservationTaskPage(tdb.db, { ...query, pageSize: 37 });
    await expect(readDevelopmentObservationTaskPage(tdb.db, { ...query, projectId: newResourceId(), pageSize: 37, after: first.nextCursor! })).rejects.toMatchObject({ kind: 'validation' });

  }, 60_000);
});
