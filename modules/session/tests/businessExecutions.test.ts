import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { RunnerBusinessEvent, RunnerBusinessReceipt, TaskId } from '@crewstation/contracts';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { drizzleBusinessExecutionStore } from '../adapters/persistence/businessExecutions';
import { sessionMigrations } from '../wiring';

const available = await testDatabaseAvailable();
const taskId = '01a0bf5d-8f4b-7001-8458-107366e7de39' as TaskId;
const incarnation = '01a0bf5d-8f4b-7001-8458-107366e7de40';
const result = { reason: 'exited' as const, exitCode: 0, durationMs: 90000 };
const receipt = (id: string): RunnerBusinessReceipt => ({ executionId: id, attempt: 1, incarnation, payloadDigest: 'a'.repeat(64), phase: 'registered', lastSequence: 0, acknowledgedSequence: 0, outputBytes: 0, result: null });
const frame = (sequence: number, data: RunnerBusinessEvent['frame']): RunnerBusinessEvent => ({ sequence, occurredAt: '2026-09-27T08:00:00.000Z', frame: data });

describe.skipIf(!available)('session 可靠执行持久事件', () => {
  let tdb: TestDatabase;
  beforeAll(async () => { tdb = await createTestDatabase([sessionMigrations]); });
  afterAll(async () => { await tdb.drop(); });

  test('终态先到不会完成或 ACK；乱序补齐后最终水位闭合，重建仓储完整补读', async () => {
    const store = drizzleBusinessExecutionStore(tdb.db), input = receipt('out-of-order');
    await store.register(taskId, input);
    const finished: RunnerBusinessReceipt = { ...input, phase: 'finished', lastSequence: 4, outputBytes: 8, result };
    const all = [frame(1, { type: 'state', state: 'running' }), frame(2, { type: 'output', stream: 'stdout', text: 'START' }), frame(3, { type: 'output', stream: 'stdout', text: 'END' }), frame(4, { type: 'result', result })];
    expect(await store.ingest(taskId, finished, [all[3]!])).toMatchObject({ complete: false, persistedThrough: 0 });
    expect(await store.list(taskId, input.executionId, 0, 100)).toEqual([]);
    await expect(store.acknowledge(taskId, input.executionId, 4)).rejects.toMatchObject({ kind: 'conflict' });
    expect(await store.ingest(taskId, finished, [all[0]!, all[2]!])).toMatchObject({ complete: false, persistedThrough: 1 });
    const restored = drizzleBusinessExecutionStore(tdb.db);
    expect(await restored.ingest(taskId, finished, [all[1]!])).toMatchObject({ complete: true, persistedThrough: 4 });
    expect(await restored.list(taskId, input.executionId, 0, 100)).toEqual(all);
    expect((await store.pending([taskId], 100)).map((row) => row.receipt.executionId)).toContain(input.executionId);
    await restored.acknowledge(taskId, input.executionId, 4); await restored.acknowledge(taskId, input.executionId, 1);
    expect(await restored.get(taskId, input.executionId)).toMatchObject({ complete: true, persistedThrough: 4, acknowledgedThrough: 4 });
    expect((await store.pending([taskId], 100)).map((row) => row.receipt.executionId)).not.toContain(input.executionId);
    expect(await restored.list(taskId, input.executionId, 1, 1)).toEqual([all[1]!]);
  });

  test('并发与重复不重复入账；变更来源、同序号内容和不同终态全部拒绝且回滚', async () => {
    const store = drizzleBusinessExecutionStore(tdb.db), input = receipt('duplicates');
    await Promise.all(Array.from({ length: 8 }, () => store.register(taskId, input)));
    const running: RunnerBusinessReceipt = { ...input, phase: 'running', lastSequence: 2, outputBytes: 4 };
    const first = frame(1, { type: 'state', state: 'running' }), output = frame(2, { type: 'output', stream: 'stdout', text: 'same' });
    await Promise.all(Array.from({ length: 8 }, () => store.ingest(taskId, running, [first, output, output])));
    expect(await store.list(taskId, input.executionId, 0, 100)).toEqual([first, output]);
    const changed = frame(2, { type: 'output', stream: 'stdout', text: 'different' });
    await expect(store.ingest(taskId, { ...running, lastSequence: 3 }, [frame(3, { type: 'output', stream: 'stdout', text: 'must-rollback' }), changed])).rejects.toMatchObject({ kind: 'conflict' });
    expect(await store.list(taskId, input.executionId, 0, 100)).toEqual([first, output]);
    for (const patch of [{ attempt: 2 }, { incarnation: crypto.randomUUID() }, { payloadDigest: 'b'.repeat(64) }]) {
      await expect(store.register(taskId, { ...input, ...patch })).rejects.toMatchObject({ kind: 'conflict' });
      await expect(store.ingest(taskId, { ...running, ...patch }, [])).rejects.toMatchObject({ kind: 'conflict' });
    }
    await expect(store.ingest(taskId, running, [output, changed])).rejects.toMatchObject({ kind: 'conflict' });
    const done: RunnerBusinessReceipt = { ...running, phase: 'finished', lastSequence: 3, result };
    expect(await store.ingest(taskId, done, [frame(3, { type: 'result', result })])).toMatchObject({ complete: true });
    await expect(store.ingest(taskId, { ...done, result: { ...result, exitCode: 1 } }, [])).rejects.toMatchObject({ kind: 'conflict' });
    await expect(store.ingest(taskId, { ...running, lastSequence: 4 }, [frame(4, { type: 'state', state: 'running' })])).rejects.toMatchObject({ kind: 'conflict' });
  });

  test('unknown cannot be cleared by delayed live receipts; only a proved final stream resolves it', async () => {
    const store = drizzleBusinessExecutionStore(tdb.db), initial = receipt('unknown-sticky');
    await store.register(taskId, initial);
    const unknown = { ...initial, phase: 'unknown' as const, lastSequence: 1 };
    await store.ingest(taskId, unknown, []);
    const delayed = { ...unknown, phase: 'running' as const };
    expect(await store.ingest(taskId, delayed, [frame(1, { type: 'state', state: 'running' })])).toMatchObject({ receipt: { phase: 'unknown' }, complete: false });
    expect(await store.ingest(taskId, { ...delayed, phase: 'finished', lastSequence: 2, result }, [frame(2, { type: 'result', result })])).toMatchObject({ receipt: { phase: 'finished' }, complete: true });
  });

  test('错误游标、越界事件、水位未产生、缺少登记和跨任务读取不会混入日志', async () => {
    const store = drizzleBusinessExecutionStore(tdb.db), input = receipt('invalid');
    await store.register(taskId, input);
    await expect(store.ingest(taskId, input, [frame(1, { type: 'state', state: 'running' })])).rejects.toMatchObject({ kind: 'validation' });
    await expect(store.ingest(taskId, { ...input, phase: 'running', lastSequence: 1 }, [frame(1, { type: 'result', result })])).rejects.toMatchObject({ kind: 'conflict' });
    await expect(store.ingest(taskId, { ...input, phase: 'finished', lastSequence: 1 }, [])).rejects.toMatchObject({ kind: 'validation' });
    await expect(store.ingest(taskId, { ...input, phase: 'finished', lastSequence: 1, result, outputBytes: 10 }, [frame(1, { type: 'result', result })])).rejects.toMatchObject({ kind: 'conflict' });
    expect(await store.get(taskId, input.executionId)).toMatchObject({ complete: false, persistedThrough: 0 });
    await expect(store.ingest(taskId, receipt('missing'), [])).rejects.toMatchObject({ kind: 'not_found' });
    await expect(store.list(taskId, input.executionId, 1, 1)).rejects.toMatchObject({ kind: 'validation' });
    await expect(store.list(taskId, input.executionId, 0, 1001)).rejects.toMatchObject({ kind: 'validation' });
    const other = '01a0bf5d-8f4b-7001-8458-107366e7de41' as TaskId;
    expect(await store.get(other, input.executionId)).toBeUndefined();
    await expect(store.list(other, input.executionId, 0, 10)).rejects.toMatchObject({ kind: 'not_found' });
    expect(await store.pending([], 100)).toEqual([]);
  });

  test('大事件补读在数据库内按总字节裁剪，页间水位连续', async () => {
    const store = drizzleBusinessExecutionStore(tdb.db), input = receipt('bounded');
    await store.register(taskId, input);
    for (let sequence = 1; sequence <= 10; sequence++) await store.ingest(taskId, { ...input, phase: 'running', lastSequence: sequence, outputBytes: sequence * 200000 }, [frame(sequence, { type: 'output', stream: 'stdout', text: 'x'.repeat(200000) })]);
    const first = await store.list(taskId, input.executionId, 0, 1000);
    expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThanOrEqual(1024 * 1024);
    expect(first.length).toBeLessThan(10);
    const next = await store.list(taskId, input.executionId, first.at(-1)!.sequence, 1000);
    expect([...first, ...next].map((event) => event.sequence)).toEqual(Array.from({ length: 10 }, (_, index) => index + 1));
  });
});
