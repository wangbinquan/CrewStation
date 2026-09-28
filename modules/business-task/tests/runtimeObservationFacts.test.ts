// RFC-034: owner facts preserve actual identities, attempts and cohort boundaries.
import { afterEach, describe, expect, test } from 'bun:test';
import type { TaskId } from '@crewstation/contracts';
import { BusinessSubtaskV3DtoSchema } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { businessTaskMigrations, readBusinessObservationFacts } from '../wiring';
import { tasks, subtasks } from '../adapters/persistence/tables';
import { executionSubtasks } from '../adapters/persistence/execution/subtaskTables';
import { executionHttpFixture } from './executionHttpFixture';
const available = await testDatabaseAvailable();
let tdb: TestDatabase;
afterEach(async () => { await tdb?.drop(); });
const window = { from: '2026-09-28T00:00:00.000Z', to: '2030-01-01T00:00:00.000Z', timezone: 'Asia/Shanghai' };
describe.skipIf(!available)('RFC-034 runtime observation owner facts', () => {
  test('time filters apply before the task bound; legacy unknown identity and timing stay null', async () => {
    tdb = await createTestDatabase([businessTaskMigrations]); const f = await executionHttpFixture(tdb.db);
    const rows = Array.from({ length: 202 }, (_, i) => ({ id: newResourceId() as TaskId, projectId: f.projectId, serviceId: f.serviceId, callerIdentity: 'demo/demo', state: 'failed', traceId: 'a'.repeat(32), volumeMode: 'persistent', profile: f.taskProfileId,
      labels: { name: 'Task ' + i }, createdAt: new Date(i === 0 ? '2020-01-01T00:00:00Z' : window.from), updatedAt: new Date(window.from) }));
    await tdb.db.insert(tasks).values(rows); const sample = rows[1]!;
    await tdb.db.insert(subtasks).values({ id: newResourceId(), taskId: sample.id, name: 'Legacy Agent', kind: 'agent', state: 'failed', attempt: 1, spec: { command: 'not-a-statistic' }, createdAt: new Date(window.from) });
    const page = await readBusinessObservationFacts(tdb.db, window); expect(page.items).toHaveLength(200); expect(page.partial).toBe(true); expect(page.items.some((t) => t.id === rows[0]!.id)).toBe(false);
    const detail = await readBusinessObservationFacts(tdb.db, { ...window, taskId: sample.id, projectId: f.projectId });
    expect(detail.items[0]?.attempts[0]).toMatchObject({ agentId: null, profileId: null, executionId: null, startedAt: null, endedAt: null });
    expect(JSON.stringify(detail)).not.toContain('not-a-statistic');
    expect((await readBusinessObservationFacts(tdb.db, { ...window, taskId: sample.id, projectId: newResourceId() })).items).toEqual([]);
  });
  test('v3 maps Agent and compute identities separately and retains both retry attempts', async () => {
    tdb = await createTestDatabase([businessTaskMigrations]); const f = await executionHttpFixture(tdb.db), instanceId = newResourceId();
    const control = await (await f.request('/v3/business-execution/control/claim', { instanceId })).json() as { epoch: number; leaseId: string };
    await f.request('/v3/business-execution/control/activate', { instanceId, expectedEpoch: control.epoch, leaseId: control.leaseId, preparationDigest: 'a'.repeat(64) });
    const response = await f.request('/v3/business-tasks', { requestKey: 'runtime-statistics', taskContractVersion: 'v1', fence: { epoch: control.epoch, leaseId: control.leaseId, instanceId } });
    expect(response.status).toBe(201); const task = await response.json() as { id: TaskId }, agentId = newResourceId(), computeId = newResourceId();
    for (const attempt of [1, 2]) { const id = newResourceId(); await tdb.db.insert(executionSubtasks).values({ id, taskId: task.id, serviceId: f.serviceId, requestKey: 'attempt-' + attempt, requestDigest: 'a', sealedPayload: 'private', payloadDigest: 'b', fenced: true, dispatch: 'accepted', updatedAt: new Date(),
      view: BusinessSubtaskV3DtoSchema.parse({ id, taskId: task.id, name: 'Agent ' + attempt, kind: 'agent', state: attempt === 1 ? 'failed' : 'running', process: attempt === 1 ? 'exited' : 'live', attempt, executionId: newResourceId(), agentProfileId: agentId, computeProfileId: computeId, profileRevision: 7, createdAt: window.from }) }); }
    const page = await readBusinessObservationFacts(tdb.db, { ...window, taskId: task.id });
    expect(page.items[0]?.attempts).toHaveLength(2); expect(page.items[0]?.attempts.map((a) => a.attempt).sort()).toEqual([1, 2]);
    for (const a of page.items[0]!.attempts) expect(a).toMatchObject({ agentId, profileId: computeId, profileRevision: 7 });
    expect(page.items[0]?.closedAt).toBeNull(); expect(page.items[0]?.traceId).toMatch(/^[a-f0-9]{32}$/);
  });
});
