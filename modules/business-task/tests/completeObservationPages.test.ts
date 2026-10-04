// RFC-034: complete owner keysets preserve every original Task and each protocol's attempts.
import { afterEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { BusinessSubtaskV3DtoSchema, type TaskId } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { businessTaskMigrations, readBusinessObservationTaskPage, readBusinessObservationAttemptPage } from '../wiring';
import { tasks, subtasks } from '../adapters/persistence/tables';
import { executionSubtasks } from '../adapters/persistence/execution/subtaskTables';
import { executionHttpFixture } from './executionHttpFixture';
const available = await testDatabaseAvailable(); let tdb: TestDatabase;
afterEach(async () => { await tdb?.drop(); });
// The v3 Task uses the real admission clock; the test cohort must include that instant on every CI date.
const anchor = Date.now();
const window = { from: new Date(anchor - 86400000).toISOString(), to: new Date(anchor + 86400000).toISOString(), timezone: 'Asia/Shanghai' };
describe.skipIf(!available)('complete business observation owner (real PG)', () => {
  test('201 original Tasks and 1001 attempts per legacy/v3 Task remain complete across arbitrary page sizes', async () => {
    tdb = await createTestDatabase([businessTaskMigrations]); const f = await executionHttpFixture(tdb.db);
    const originals = Array.from({ length: 201 }, (_, n) => ({ id: newResourceId() as TaskId, projectId: f.projectId, serviceId: f.serviceId, callerIdentity: 'demo/demo', state: 'failed', traceId: 'a'.repeat(32), volumeMode: 'persistent', profile: f.taskProfileId, labels: { name: 'Original ' + n }, createdAt: new Date(window.from), updatedAt: new Date(window.from) }));
    await tdb.db.insert(tasks).values(originals); const legacy = originals[0]!;
    const outside = [new Date(Date.parse(window.from) - 1), new Date(window.to)].map((createdAt) => ({ ...legacy, id: newResourceId() as TaskId, createdAt }));
    await tdb.db.insert(tasks).values(outside);
    const instanceId = newResourceId(), control = await (await f.request('/v3/business-execution/control/claim', { instanceId })).json() as { epoch: number; leaseId: string };
    await f.request('/v3/business-execution/control/activate', { instanceId, expectedEpoch: control.epoch, leaseId: control.leaseId, preparationDigest: 'a'.repeat(64) });
    const response = await f.request('/v3/business-tasks', { requestKey: 'complete-statistics', taskContractVersion: 'v1', fence: { epoch: control.epoch, leaseId: control.leaseId, instanceId } });
    expect(response.status).toBe(201); const modern = await response.json() as { id: TaskId; createdAt: string };
    expect(Date.parse(modern.createdAt)).toBeGreaterThanOrEqual(Date.parse(window.from));
    expect(Date.parse(modern.createdAt)).toBeLessThan(Date.parse(window.to));
    const legacyAttempts = Array.from({ length: 1001 }, (_, n) => ({ id: newResourceId(), taskId: legacy.id, name: 'Original legacy ' + n, kind: 'agent', state: 'failed', attempt: 1, spec: { command: 'private-command' }, createdAt: new Date(window.from) }));
    await tdb.db.insert(subtasks).values(legacyAttempts);
    const modernAttempts = Array.from({ length: 1001 }, (_, n) => { const id = newResourceId(); return { id, taskId: modern.id, serviceId: f.serviceId, requestKey: 'full-attempt-' + n, requestDigest: 'a', sealedPayload: 'private-command', payloadDigest: 'b', fenced: true, dispatch: 'accepted', updatedAt: new Date(window.from), view: BusinessSubtaskV3DtoSchema.parse({ id, taskId: modern.id, name: 'Original v3 ' + n, kind: 'agent', state: 'running', process: 'live', attempt: n + 1, executionId: newResourceId(), agentProfileId: newResourceId(), computeProfileId: newResourceId(), profileRevision: 7, createdAt: window.from }) }; });
    await tdb.db.insert(executionSubtasks).values(modernAttempts);
    await tdb.db.transaction(async (db) => {
      const all: string[] = []; let after: string | undefined;
      do { const page = await readBusinessObservationTaskPage(db, { ...window, projectId: f.projectId, pageSize: 37, ...(after === undefined ? {} : { after }) }); all.push(...page.items.map((row) => row.id)); expect(JSON.stringify(page)).not.toContain('private-command'); after = page.nextCursor ?? undefined; } while (after !== undefined);
      expect(all.length).toBe(202); expect(new Set(all).size).toBe(202); expect([...all].sort()).toEqual([...originals.map((row) => row.id), modern.id].sort());
      for (const row of outside) expect(all).not.toContain(row.id);
      const admitted = await db.execute<{ createdAt: string | Date }>(sql`SELECT created_at AS "createdAt" FROM business_task.execution_operations WHERE kind='create-task' AND intent->'task'->>'id'=${modern.id}`);
      expect(admitted).toHaveLength(1);
      expect(new Date(admitted[0]!.createdAt).getTime()).toBeGreaterThanOrEqual(Date.parse(window.from));
      expect(new Date(admitted[0]!.createdAt).getTime()).toBeLessThan(Date.parse(window.to));
      for (const [taskId, expected] of [[legacy.id, legacyAttempts], [modern.id, modernAttempts]] as const) {
        const ids: string[] = []; let cursor: string | undefined;
        do { const page = await readBusinessObservationAttemptPage(db, { ...window, taskId, projectId: f.projectId, pageSize: 71, ...(cursor === undefined ? {} : { after: cursor }) }); ids.push(...page.items.map((row) => row.id)); expect(JSON.stringify(page)).not.toContain('private-command'); cursor = page.nextCursor ?? undefined; } while (cursor !== undefined);
        expect(ids).toEqual(expected.map((row) => row.id).sort()); expect(new Set(ids).size).toBe(1001);
      }
      for (const taskId of [legacy.id,modern.id]) {
        expect((await readBusinessObservationAttemptPage(db,{...window,taskId,projectId:newResourceId(),pageSize:17})).items).toEqual([]);
        expect((await readBusinessObservationAttemptPage(db,{...window,taskId,projectId:f.projectId,sourceKind:'development-agent',pageSize:17})).items).toEqual([]);
      }
      const first = await readBusinessObservationTaskPage(db, { ...window, pageSize: 37 });
      await expect(readBusinessObservationTaskPage(db, { ...window, pageSize: 37, projectId: newResourceId(), after: first.nextCursor! })).rejects.toMatchObject({ kind: 'validation' });
      const attempt = await readBusinessObservationAttemptPage(db, { ...window, taskId: legacy.id, pageSize: 37 });
      await expect(readBusinessObservationAttemptPage(db, { ...window, taskId: modern.id, pageSize: 37, after: attempt.nextCursor! })).rejects.toMatchObject({ kind: 'validation' });
      const parent = await db.execute<{ id: string }>(sql`SELECT id FROM business_task.tasks WHERE id=${legacy.id}`); expect(parent[0]!.id).toBe(legacy.id);
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
  }, 60000);
});
