import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { BusinessOperationDto, BusinessSubtaskV3Dto, RunnerBusinessEvent } from '@crewstation/contracts';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { businessTaskMigrations } from '../wiring';
import { executionCommandFixture } from './executionCommandFixture';
import { drizzleExecutionSubtasks } from '../adapters/persistence/execution/subtasks';
import { drizzleExecutionCancellations } from '../adapters/persistence/execution/cancellations';
import { drizzleExecutionProjection } from '../adapters/persistence/execution/projection';
import { executionAgentFixture } from './executionAgentFixture';
import { newResourceId } from '@crewstation/kernel';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-027 cancellation request and proof of completion', () => {
  let tdb: TestDatabase;
  beforeAll(async () => { tdb = await createTestDatabase([businessTaskMigrations]); });
  afterAll(async () => { await tdb?.drop(); });

  test('cancel before dispatch invalidates an outstanding lease and records one terminal event without contacting Runner', async () => {
    const f = await executionCommandFixture(tdb.db); f.behavior.disconnectAfterInfo = true;
    const subtask = await (await f.request(f.path, f.input)).json() as BusinessSubtaskV3Dto;
    const store = drizzleExecutionSubtasks(tdb.db), stale = (await store.claim(newResourceId(), subtask.id))!;
    const before = f.commands.length, body = { requestKey: 'cancel', expectedAttempt: 1, fence: f.fence };
    const responses = await Promise.all(Array.from({ length: 5 }, () => f.request(`${f.path}/${subtask.id}/cancel`, body)));
    expect(responses.every((response) => response.status === 202)).toBe(true);
    const operations = await Promise.all(responses.map((response) => response.json() as Promise<BusinessOperationDto>));
    expect(new Set(operations.map((operation) => operation.operationId)).size).toBe(1); expect(operations[0]?.state).toBe('succeeded');
    expect(f.commands.length).toBe(before); expect(f.behavior.starts).toBe(0);
    expect((await drizzleExecutionProjection(tdb.db).pendingConsumption()).some((item) => item.subtaskId === subtask.id)).toBe(false);
    expect(await store.checkpoint(stale, newResourceId())).toBe(false);
    const saved = (await store.get(f.serviceId, f.task.id, subtask.id))!.view;
    expect(saved).toMatchObject({ state: 'cancelled', process: 'not-started', result: { reason: 'cancelled-before-start' } });
    const events = await (await f.request(`/v3/business-tasks/${f.task.id}/events`)).json(); expect(events.items).toHaveLength(1);
    expect((await f.request(f.path, f.input)).status).toBe(200); expect(f.behavior.starts).toBe(0);
  });

  test('running cancel stays cancelling after receipt; terminal output proof resolves operation, late cancel preserves success', async () => {
    const f = await executionCommandFixture(tdb.db);
    const subtask = await (await f.request(f.path, f.input)).json() as BusinessSubtaskV3Dto;
    const body = { requestKey: 'cancel', expectedAttempt: 1, fence: f.fence };
    const response = await f.request(`${f.path}/${subtask.id}/cancel`, body); expect(response.status).toBe(202);
    const operation = await response.json() as BusinessOperationDto; expect(operation.state).toBe('running');
    expect(await (await f.request(`${f.path}/${subtask.id}`)).json()).toMatchObject({ state: 'cancelling', process: 'live' });
    const receipt = f.receipts.get(subtask.executionId)!;
    f.runner.getBusinessExecution = async () => ({ taskId: f.task.id, receipt, persistedThrough: 2, acknowledgedThrough: 2, complete: true });
    const events: RunnerBusinessEvent[] = [
      { sequence: 1, occurredAt: new Date().toISOString(), frame: { type: 'state', state: 'running' } },
      { sequence: 2, occurredAt: new Date().toISOString(), frame: { type: 'result', result: receipt.result! } },
    ];
    f.runner.listBusinessExecutionEvents = async (_task, _exec, after = 0) => events.filter((event) => event.sequence > after);
    await f.make().module.api.v3.runOnce();
    expect(await (await f.request(`${f.path}/${subtask.id}`)).json()).toMatchObject({ state: 'cancelled', process: 'exited', result: { reason: 'cancelled' } });
    expect((await drizzleExecutionCancellations(tdb.db).get(operation.operationId))?.state).toBe('succeeded');
    const before = f.commands.length; expect((await f.request(`${f.path}/${subtask.id}/cancel`, { ...body, fence: undefined })).status).toBe(202); expect(f.commands.length).toBe(before);
    expect((await f.request(`${f.path}/${subtask.id}/cancel`, { ...body, expectedAttempt: 2 })).status).toBe(409);
  });

  test('offline cancel never pretends completion; stale attempts and cross-service requests cannot cancel', async () => {
    const f = await executionCommandFixture(tdb.db), subtask = await (await f.request(f.path, f.input)).json() as BusinessSubtaskV3Dto;
    const path = `${f.path}/${subtask.id}/cancel`, body = { requestKey: 'cancel', expectedAttempt: 1, fence: f.fence };
    expect((await f.request(path, { ...body, expectedAttempt: 2 })).status).toBe(409);
    expect((await f.request(path, { ...body, fence: undefined })).status).toBe(409);
    const other = await executionCommandFixture(tdb.db); expect((await other.request(path, body)).status).toBe(404);
    f.env.connected = false;
    const operation = await (await f.request(path, body)).json() as BusinessOperationDto;
    expect(operation).toMatchObject({ state: 'pending', message: 'cancellation_unconfirmed' });
    expect(await (await f.request(`${f.path}/${subtask.id}`)).json()).toMatchObject({ state: 'cancelling' });
    expect(f.commands.some((command) => command.type === 'cancelBusinessExecution')).toBe(false);
  });
  test('physical release finalizes offline cancellation with a gap, preserves output and rejects late success', async () => {
    const f = await executionCommandFixture(tdb.db), subtask = await (await f.request(f.path, f.input)).json() as BusinessSubtaskV3Dto;
    const receipt = f.receipts.get(subtask.executionId)!, store = drizzleExecutionSubtasks(tdb.db), projection = drizzleExecutionProjection(tdb.db);
    const saved = (await store.get(f.serviceId, f.task.id, subtask.id))!;
    await projection.pending(20);
    const snapshot = { taskId: f.task.id, receipt, persistedThrough: 1, acknowledgedThrough: 0, complete: false };
    await projection.append(saved, snapshot, [{ sequence: 1, occurredAt: new Date().toISOString(), frame: { type: 'output', stream: 'stdout', text: 'before disconnect' } }]);
    f.env.connected = false;
    const operation = await (await f.request(`${f.path}/${subtask.id}/cancel`, { requestKey: 'stop', expectedAttempt: 1, fence: f.fence })).json() as BusinessOperationDto;
    expect(operation.state).toBe('pending');
    f.env.state = 'released';
    await f.request(`${f.path}/${subtask.id}/cancel`, { requestKey: 'stop', expectedAttempt: 1, fence: f.fence });
    expect((await store.get(f.serviceId, f.task.id, subtask.id))?.view).toMatchObject({ state: 'cancelled', process: 'exited', result: { stdout: 'before disconnect', truncated: true, reason: 'cancelled-after-runtime-stop' } });
    expect((await drizzleExecutionCancellations(tdb.db).get(operation.operationId))?.state).toBe('succeeded');
    const page = await projection.events(f.serviceId, f.task.id, { limit: 200 });
    expect(page.items.filter((event) => event.subtaskId === subtask.id).map((event) => event.type)).toEqual(['output', 'gap', 'result']);
    expect((await projection.pendingConsumption()).find((item) => item.subtaskId === subtask.id)?.stopped).toBe(true);
    await projection.append(saved, { ...snapshot, complete: true }, []);
    expect((await store.get(f.serviceId, f.task.id, subtask.id))?.view.result?.truncated).toBe(true);
  });

  test('disconnected dedicated Agent is released, but cancellation waits for physical release proof', async () => {
    const f = await executionAgentFixture(tdb.db), subtask = await (await f.request(f.path, f.input)).json() as BusinessSubtaskV3Dto;
    const env = f.ready(); await f.make().module.api.v3.runOnce(); env.connected = false;
    const operation = await (await f.request(`${f.path}/${subtask.id}/cancel`, { requestKey: 'stop', expectedAttempt: 1, fence: f.fence })).json() as BusinessOperationDto;
    expect(operation.state).toBe('pending'); expect(env.state).toBe('releasing');
    expect((await f.get(subtask.id)).state).toBe('cancelling');
    env.state = 'released'; await f.request(`${f.path}/${subtask.id}/cancel`, { requestKey: 'stop', expectedAttempt: 1, fence: f.fence });
    expect(await f.get(subtask.id)).toMatchObject({ state: 'cancelled', result: { truncated: true } });
  });

  test('unknown Agent admission requires owner tombstone, never mere absence', async () => {
    const f = await executionAgentFixture(tdb.db); f.agentBehavior.createLost = true;
    const subtask = await (await f.request(f.path, f.input)).json() as BusinessSubtaskV3Dto;
    f.environments.delete(f.creates[0]!.id);
    const cancel = () => f.request(`${f.path}/${subtask.id}/cancel`, { requestKey: 'stop', expectedAttempt: 1, fence: f.fence });
    expect(await (await cancel()).json()).toMatchObject({ state: 'pending' });
    f.environmentPort.blockBusinessAdmission = async (serviceId, id) => { expect(serviceId).toBe(f.serviceId); expect(id).toBe(f.creates[0]!.id); return true; };
    expect(await (await cancel()).json()).toMatchObject({ state: 'succeeded' });
    expect(await f.get(subtask.id)).toMatchObject({ state: 'cancelled', process: 'not-started' });
  });

});
