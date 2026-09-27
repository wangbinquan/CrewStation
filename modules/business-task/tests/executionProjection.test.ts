import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { BusinessSubtaskV3Dto, RunnerBusinessEvent, RunnerBusinessReceipt, StoredBusinessExecutionDto } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { businessTaskMigrations } from '../wiring';
import { drizzleExecutionSubtasks } from '../adapters/persistence/execution/subtasks';
import { drizzleExecutionProjection } from '../adapters/persistence/execution/projection';
import { executionCommandFixture } from './executionCommandFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-027 durable command result projection', () => {
  let tdb: TestDatabase;
  beforeAll(async () => { tdb = await createTestDatabase([businessTaskMigrations]); });
  afterAll(async () => { await tdb?.drop(); });
  const fixture = async () => {
    const f = await executionCommandFixture(tdb.db), submitted = await f.request(f.path, f.input);
    expect(submitted.status).toBe(201);
    const view = await submitted.json() as BusinessSubtaskV3Dto, receipt = f.receipts.get(view.executionId)!;
    const store = drizzleExecutionSubtasks(tdb.db), projection = drizzleExecutionProjection(tdb.db);
    const subtask = (await store.get(f.serviceId, f.task.id, view.id))!;
    const state: RunnerBusinessEvent = { sequence: 1, occurredAt: new Date().toISOString(), frame: { type: 'state', state: 'running' } };
    const output: RunnerBusinessEvent = { sequence: 2, occurredAt: state.occurredAt, frame: { type: 'output', stream: 'stdout', text: 'hello' } };
    const result: RunnerBusinessEvent = { sequence: 3, occurredAt: state.occurredAt, frame: { type: 'result', result: { exitCode: 0, reason: 'exited', durationMs: 91_000 } } };
    const final: RunnerBusinessReceipt = { ...receipt, phase: 'finished', result: result.frame.type === 'result' ? result.frame.result : null, lastSequence: 3, outputBytes: 5 };
    const snapshot: StoredBusinessExecutionDto = { taskId: f.task.id, receipt: final, persistedThrough: 3, acknowledgedThrough: 3, complete: true };
    await projection.pending(20);
    return { ...f, view, subtask, store, projection, state, output, result, snapshot };
  };

  test('a finished receipt is not a complete result; contiguous output and final event commit once', async () => {
    const f = await fixture();
    await f.projection.append(f.subtask, { ...f.snapshot, complete: false, persistedThrough: 1 }, [f.state]);
    expect((await f.store.get(f.serviceId, f.task.id, f.view.id))?.view.result).toBeUndefined();
    await expect(f.projection.append(f.subtask, f.snapshot, [f.result])).rejects.toThrow('连续');
    await f.projection.append(f.subtask, f.snapshot, [f.output, f.result]);
    await f.projection.append(f.subtask, f.snapshot, [f.state, f.output, f.result]);
    const final = (await f.store.get(f.serviceId, f.task.id, f.view.id))!.view;
    expect(final).toMatchObject({ state: 'succeeded', process: 'exited', result: { stdout: 'hello', stderr: '', exitCode: 0, truncated: false } });
    const events = await f.projection.events(f.serviceId, f.task.id, { limit: 200 });
    expect(events.items).toHaveLength(3); expect(events.hasMore).toBe(false);
    expect(events.items[2]?.cursor).toBe(final.result!.finalCursor);
    expect(await f.projection.output(f.serviceId, f.task.id, f.view.id)).toMatchObject({ stdout: 'hello', resultRef: final.result!.finalCursor });
    await expect(f.projection.append(f.subtask, f.snapshot, [{ ...f.output, frame: { type: 'output', stream: 'stdout', text: 'changed' } }])).rejects.toThrow('内容已变化');
    expect((await f.projection.events(f.serviceId, f.task.id, { limit: 200 })).items).toHaveLength(3);
  });

  test('cursor belongs to task and filter; paging survives module reconstruction and never spawns', async () => {
    const f = await fixture(); await f.projection.append(f.subtask, f.snapshot, [f.state, f.output, f.result]);
    const app = f.make(), path = `/v3/business-tasks/${f.task.id}/events`;
    const first = await (await app.request(`${path}?limit=1`)).json(); expect(first.items).toHaveLength(1); expect(first.hasMore).toBe(true);
    const second = await (await app.request(`${path}?after=${first.nextCursor}&limit=2`)).json(); expect(second.items).toHaveLength(2); expect(second.hasMore).toBe(false);
    expect((await app.request(`${path}?after=${first.nextCursor}&subtaskId=${f.view.id}`)).status).toBe(400);
    const filtered = await (await app.request(`${path}?subtaskId=${f.view.id}`)).json(); expect(filtered.items).toHaveLength(3);
    expect(filtered.items[2].data.finalCursor).toBe(filtered.nextCursor);
    const other = await fixture(); expect((await other.request(`${path}?limit=1`)).status).toBe(404);
    expect((await app.request(`${path}?after=not-a-cursor`)).status).toBe(400);
    expect((await app.request(`${f.path}/${f.view.id}/output`)).status).toBe(200); expect(f.behavior.starts).toBe(1);
  });

  test('SSE replays the pagination log, resumes Last-Event-ID and stops observation without cancellation', async () => {
    const f = await fixture(); await f.projection.append(f.subtask, f.snapshot, [f.state, f.output, f.result]);
    const events = await f.projection.events(f.serviceId, f.task.id, { limit: 1 }), path = `/v3/business-tasks/${f.task.id}/events/stream`;
    const response = await f.request(path, undefined, 'trusted', { 'last-event-id': events.nextCursor! });
    expect(response.status).toBe(200); expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain('event: output'); expect(first).toContain('hello'); expect(first).not.toContain('event: execution-state');
    await reader.cancel();
    expect(f.behavior.starts).toBe(1); expect(f.commands.some((command) => command.type === 'cancelBusinessExecution')).toBe(false);
    expect((await f.request(`${path}?after=different`, undefined, 'trusted', { 'last-event-id': events.nextCursor! })).status).toBe(400);
  });

  test('final projection wins over late unknown dispatch reply; an unknown historical state is not live proof', async () => {
    const f = await fixture();
    await f.projection.append(f.subtask, { ...f.snapshot, complete: false, persistedThrough: 1, receipt: { ...f.snapshot.receipt, phase: 'unknown', result: null } }, [f.state]);
    expect((await f.store.get(f.serviceId, f.task.id, f.view.id))?.view.process).toBe('unknown');
    // Simulate an unknown start receipt being reconciled by a worker while the projector obtains the final stream.
    const { executionSubtasks } = await import('../adapters/persistence/execution/subtaskTables');
    const { eq } = await import('drizzle-orm');
    await tdb.db.update(executionSubtasks).set({ dispatch: 'unknown' }).where(eq(executionSubtasks.id, f.view.id));
    const claim = (await f.store.claim(newResourceId(), f.view.id))!;
    await f.projection.append(f.subtask, f.snapshot, [f.output, f.result]);
    expect(await f.store.settle(claim, { dispatch: 'unknown', view: { ...f.view, process: 'unknown' } })).toBe(true);
    const saved = (await f.store.get(f.serviceId, f.task.id, f.view.id))!;
    expect(saved.dispatch).toBe('accepted'); expect(saved.view.state).toBe('succeeded'); expect(saved.receipt?.phase).toBe('finished');
  });

  test('background projection uses durable session pages; GET alone never advances or runs a process', async () => {
    const f = await fixture();
    f.runner.getBusinessExecution = async () => f.snapshot;
    f.runner.listBusinessExecutionEvents = async (_task, _execution, after = 0) => [f.state, f.output, f.result].filter((event) => event.sequence > after);
    const before = f.commands.length;
    expect((await f.request(`${f.path}/${f.view.id}`)).status).toBe(200);
    expect((await f.store.get(f.serviceId, f.task.id, f.view.id))?.view.state).toBe('running');
    await f.make().module.api.v3.runOnce();
    expect((await f.store.get(f.serviceId, f.task.id, f.view.id))?.view.state).toBe('succeeded');
    expect(f.commands.length).toBe(before); expect(f.behavior.starts).toBe(1);
  });
  test('lost source-consumption ACK retries after reconstruction without reprojecting final output', async () => {
    const f = await fixture();
    await f.projection.append(f.subtask, f.snapshot, [f.state, f.output, f.result]);
    let calls = 0;
    f.runner.getBusinessExecution = async () => f.snapshot;
    f.runner.listBusinessExecutionEvents = async () => [];
    f.runner.consumeBusinessExecution = async (_task, executionId, through) => {
      if (executionId !== f.view.executionId) return;
      expect(through).toBe(3);
      if (++calls === 1) throw new Error('committed consumption, reply lost');
    };
    await f.make().module.api.v3.runOnce();
    expect((await f.projection.pendingConsumption()).some((item) => item.subtaskId === f.view.id)).toBe(true);
    await f.make().module.api.v3.runOnce();
    await f.make().module.api.v3.runOnce();
    expect(calls).toBe(2);
    expect((await f.projection.pendingConsumption()).some((item) => item.subtaskId === f.view.id)).toBe(false);
    expect((await f.projection.events(f.serviceId, f.task.id, { subtaskId: f.view.id, limit: 100 })).items).toHaveLength(3);
  });

});
