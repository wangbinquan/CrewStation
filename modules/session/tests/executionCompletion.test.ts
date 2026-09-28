import { afterEach, describe, expect, test } from 'bun:test';
import type { RunnerBusinessReceipt, TaskId } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { createSessionClient } from '../../../packages/session-client';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { drizzleBusinessExecutionStore } from '../adapters/persistence/businessExecutions';
import { createSessionModule, sessionMigrations } from '../wiring';

const available = await testDatabaseAvailable();
const result = { reason: 'exited' as const, exitCode: 0, durationMs: 1234 };
const receipt = (executionId: string): RunnerBusinessReceipt => ({ executionId, attempt: 2, incarnation: crypto.randomUUID(), payloadDigest: 'a'.repeat(64),
  phase: 'finished', lastSequence: 2, acknowledgedSequence: 0, outputBytes: 0, result });
const first = { sequence: 1, occurredAt: '2026-09-28T01:00:00.000Z', frame: { type: 'state' as const, state: 'running' as const } };
const final = { sequence: 2, occurredAt: '2026-09-28T01:00:01.000Z', frame: { type: 'result' as const, result } };

describe.skipIf(!available)('RFC-035 durable execution completion evidence', () => {
  let db: TestDatabase;
  afterEach(async () => { await db?.drop(); });
  async function fixture() {
    db = await createTestDatabase([sessionMigrations]);
    return { store: drizzleBusinessExecutionStore(db.db), taskId: newResourceId() as TaskId, input: receipt('attempt/2') };
  }
  test('gaps, raw completion and Runner ACK are insufficient; exact product consumption creates one immutable proof', async () => {
    const { store, taskId, input } = await fixture();
    await store.register(taskId, input); await store.ingest(taskId, input, [final]);
    expect(await store.completionProof(taskId, input.executionId)).toBeUndefined();
    await expect(store.consume(taskId, input.executionId, 2)).rejects.toMatchObject({ kind: 'conflict' });
    await store.ingest(taskId, input, [first]); await store.acknowledge(taskId, input.executionId, 2);
    expect(await store.completionProof(taskId, input.executionId)).toBeUndefined();
    await expect(store.consume(taskId, input.executionId, 1)).rejects.toMatchObject({ kind: 'conflict' });
    await Promise.all(Array.from({ length: 6 }, () => store.consume(taskId, input.executionId, 2)));
    const proof = await store.completionProof(taskId, input.executionId);
    expect(proof).toEqual({ taskId, executionId: input.executionId, attempt: 2, incarnation: input.incarnation, payloadDigest: input.payloadDigest,
      lastSequence: 2, resultDigest: jsonHash(result), complete: true, persistedAt: expect.any(String) });
    await drizzleBusinessExecutionStore(db.db).consume(taskId, input.executionId, 2);
    expect(await store.completionProof(taskId, input.executionId)).toEqual(proof);
    expect(await store.completionProof(newResourceId() as TaskId, input.executionId)).toBeUndefined();
  });
  test('seven-day log expiry leaves proof readable through module and bounded HTTP client without resurrecting events', async () => {
    const { store, taskId, input } = await fixture();
    await store.register(taskId, input); await store.ingest(taskId, input, [first, final]);
    await store.consume(taskId, input.executionId, 2);
    const proof = await store.completionProof(taskId, input.executionId);
    await db.db.execute(sql`UPDATE session.business_executions SET consumed_at=clock_timestamp()-interval '8 days' WHERE task_id=${taskId}`);
    expect(await store.expire()).toBe(2);
    const module = createSessionModule({ db: db.db, runnerAuth: { verifyRunnerToken: async () => ({ ok: false, reason: 'offline' }) },
      taskAccess: { canOpenStream: async () => false, onRunnerConnected: async () => {}, onRunnerDisconnected: async () => {} }, isAdmin: async () => false,
      settings: { selfAddress: 'local', commandTimeoutMs: 1000, runnerStaleMs: 60000, replayLimit: 100 } });
    const app = createApp({ name: 'completion-proof-test' }); app.route('/', module.http.internal);
    const client = createSessionClient('http://session', Object.assign(async (url: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal); return app.request(String(url), init);
    }, { preconnect: fetch.preconnect }));
    expect(await client.getExecutionCompletionProof(taskId, input.executionId)).toEqual(proof!);
    expect(await module.api.getExecutionCompletionProof(taskId, input.executionId)).toEqual(proof);
    await expect(client.getBusinessExecution(taskId, input.executionId)).rejects.toMatchObject({ kind: 'gone' });
    await expect(client.listBusinessExecutionEvents(taskId, input.executionId)).rejects.toMatchObject({ kind: 'gone' });
    await expect(client.getExecutionCompletionProof(newResourceId() as TaskId, input.executionId)).rejects.toMatchObject({ kind: 'not_found' });
    await store.consume(taskId, input.executionId, 2);
    expect(await store.completionProof(taskId, input.executionId)).toEqual(proof);
    expect(await store.expire()).toBe(0);
  });
  test('stopped and never-started streams never masquerade as complete final events', async () => {
    const { store, taskId, input } = await fixture();
    await store.register(taskId, { ...input, phase: 'running', result: null });
    await store.consume(taskId, input.executionId, 0, true);
    await store.consume(taskId, 'never-started', 0, true);
    expect(await store.completionProof(taskId, input.executionId)).toBeUndefined();
    expect(await store.completionProof(taskId, 'never-started')).toBeUndefined();
    await expect(store.consume(taskId, input.executionId, 2)).rejects.toMatchObject({ kind: 'conflict' });
    await expect(store.consume(taskId, 'never-started', 0)).rejects.toMatchObject({ kind: 'not_found' });
  });
  test('proof write failure rolls back the consumer handshake; retries cannot replace a conflicting proof', async () => {
    const { store, taskId, input } = await fixture();
    await store.register(taskId, input); await store.ingest(taskId, input, [first, final]);
    await db.db.execute(sql`ALTER TABLE session.execution_completion_proofs ADD CONSTRAINT fail_proof CHECK (false)`);
    await expect(store.consume(taskId, input.executionId, 2)).rejects.toThrow();
    expect((await db.db.execute<{ consumed_at: Date | null }>(sql`SELECT consumed_at FROM session.business_executions WHERE task_id=${taskId}`))[0]!.consumed_at).toBeNull();
    await db.db.execute(sql`ALTER TABLE session.execution_completion_proofs DROP CONSTRAINT fail_proof`);
    await store.consume(taskId, input.executionId, 2);
    await db.db.execute(sql`UPDATE session.execution_completion_proofs SET record=jsonb_set(record,'{resultDigest}',to_jsonb(${'b'.repeat(64)}::text)) WHERE task_id=${taskId}`);
    await expect(store.consume(taskId, input.executionId, 2)).rejects.toMatchObject({ kind: 'conflict' });
  });
});
