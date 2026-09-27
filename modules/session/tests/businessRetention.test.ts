import { afterEach, describe, expect, test } from 'bun:test';
import type { RunnerBusinessReceipt, TaskId } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { drizzleBusinessExecutionStore } from '../adapters/persistence/businessExecutions';
import { sessionMigrations } from '../wiring';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-027 source log retention after durable product consumption', () => {
  let db: TestDatabase; afterEach(async () => { await db?.drop(); });
  test('Runner ACK alone never expires raw data; final consumer watermark starts seven days; tombstone prevents resurrection', async () => {
    db = await createTestDatabase([sessionMigrations]); const store = drizzleBusinessExecutionStore(db.db), taskId = newResourceId() as TaskId;
    const result = { reason: 'exited' as const, exitCode: 0, durationMs: 1 };
    const receipt: RunnerBusinessReceipt = { executionId: 'source', attempt: 1, incarnation: crypto.randomUUID(), payloadDigest: 'a'.repeat(64), phase: 'finished', lastSequence: 1, acknowledgedSequence: 0, outputBytes: 0, result };
    await store.register(taskId, receipt);
    await expect(store.consume(taskId, 'source', 1)).rejects.toMatchObject({ kind: 'conflict' });
    const event = { sequence: 1, occurredAt: new Date().toISOString(), frame: { type: 'result' as const, result } };
    await store.ingest(taskId, receipt, [event]); await store.acknowledge(taskId, 'source', 1);
    expect(await store.expire()).toBe(0);
    await expect(store.consume(taskId, 'source', 0)).rejects.toMatchObject({ kind: 'conflict' });
    await store.consume(taskId, 'source', 1); expect(await store.expire()).toBe(0);
    await db.db.execute(sql`UPDATE session.business_executions SET consumed_at=clock_timestamp()-interval '8 days' WHERE task_id=${taskId}`);
    const restarted = drizzleBusinessExecutionStore(db.db); expect(await restarted.expire()).toBe(1);
    for (const query of [() => restarted.get(taskId, 'source'), () => restarted.list(taskId, 'source', 0, 10), () => restarted.register(taskId, receipt), () => restarted.ingest(taskId, receipt, [event])]) await expect(query()).rejects.toMatchObject({ kind: 'gone', details: { code: 'execution_events_expired' } });
    await restarted.consume(taskId, 'source', 1); // Lost consumer ACK retries remain harmless after expiry.
    expect(await restarted.pending([taskId], 10)).toEqual([]);
    expect(await restarted.expire()).toBe(0);
    expect((await db.db.execute(sql`SELECT * FROM session.business_execution_events WHERE task_id=${taskId}`)).length).toBe(0);
  });
  test('stopped runtime leaves a tombstone even before receipt; partial raw output expires without claiming completeness', async () => {
    db = await createTestDatabase([sessionMigrations]); const store = drizzleBusinessExecutionStore(db.db), taskId = newResourceId() as TaskId;
    const receipt: RunnerBusinessReceipt = { executionId: 'stopped', attempt: 1, incarnation: crypto.randomUUID(), payloadDigest: 'a'.repeat(64), phase: 'running', lastSequence: 1, acknowledgedSequence: 0, outputBytes: 4, result: null };
    await store.register(taskId, receipt);
    await store.ingest(taskId, receipt, [{ sequence: 1, occurredAt: new Date().toISOString(), frame: { type: 'output', stream: 'stdout', text: 'tail' } }]);
    await store.consume(taskId, 'stopped', 0, true); await store.consume(taskId, 'never-registered', 0, true);
    expect((await store.get(taskId, 'stopped'))?.complete).toBe(false);
    expect(await store.list(taskId, 'stopped', 0, 10)).toHaveLength(1);
    expect(await store.pending([taskId], 10)).toEqual([]);
    await expect(store.register(taskId, { ...receipt, executionId: 'never-registered' })).rejects.toMatchObject({ details: { code: 'execution_runtime_stopped' } });
    await expect(store.ingest(taskId, receipt, [])).rejects.toMatchObject({ details: { code: 'execution_runtime_stopped' } });
    await db.db.execute(sql`UPDATE session.business_stopped_executions SET stopped_at=clock_timestamp()-interval '8 days' WHERE task_id=${taskId}`);
    expect(await store.expire()).toBe(1);
    await expect(store.get(taskId, 'stopped')).rejects.toMatchObject({ kind: 'gone' });
    await expect(store.register(taskId, { ...receipt, executionId: 'never-registered' })).rejects.toMatchObject({ kind: 'gone' });
    await store.consume(taskId, 'stopped', 0, true); expect(await store.expire()).toBe(0);
  });

});
