import { afterEach, describe, expect, test } from 'bun:test';
import type { RunnerBusinessEvent, RunnerBusinessReceipt, RunnerUsageCapture, TaskId } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { drizzleBusinessExecutionStore } from '../adapters/persistence/businessExecutions';
import { drizzleBusinessUsageSourceStore } from '../adapters/persistence/businessUsageSources';
import { createSessionModule, sessionMigrations } from '../wiring';

const available = await testDatabaseAvailable(), at = '2026-09-28T08:00:00.000Z';
const receipt = (executionId: string): RunnerBusinessReceipt => ({ executionId, attempt: 1, incarnation: crypto.randomUUID(), payloadDigest: 'a'.repeat(64), phase: 'running', lastSequence: 0, acknowledgedSequence: 0, outputBytes: 0, result: null });
const capture = (revision: number): RunnerUsageCapture => ({ version: 1, diagnostics: [], measurements: [{
  recordId: 'step-' + revision, revision, occurredAt: null, observedAt: at, adapterVersion: 'test@1', actualModel: null,
  reporting: 'delta', inclusion: 'self', coverage: 'partial', validity: 'valid', basis: { kind: 'invocation' }, coveredThroughTurn: null,
  scope: { root: 'native', session: 'native', parentSession: null, ancestors: [], turn: 'turn', turnIndex: 0, level: 'request' },
  usage: { input: '9007199254740993', cacheRead: null, cacheWrite: '0', output: '11' },
}] });
const usage = (sequence: number, value = capture(sequence)): RunnerBusinessEvent => ({ sequence, occurredAt: at,
  frame: { type: 'agent', event: { agentId: 'agent', seq: sequence, at, type: 'usage', usageCapture: value } } });
const state = (sequence: number): RunnerBusinessEvent => ({ sequence, occurredAt: at, frame: { type: 'state', state: 'running' } });

// Numeric evidence must survive both process failure and raw-journal expiry without entering the output stream twice.
describe.skipIf(!available)('RFC-034 independent Session numeric outbox', () => {
  let tdb: TestDatabase;
  afterEach(async () => { await tdb?.drop(); });
  const setup = async () => { tdb = await createTestDatabase([sessionMigrations]); return { raw: drizzleBusinessExecutionStore(tdb.db), numeric: drizzleBusinessUsageSourceStore(tdb.db), taskId: newResourceId() as TaskId }; };

  test('out-of-order evidence waits for the committed contiguous watermark; duplicate ingest is single-copy', async () => {
    const { raw, numeric, taskId } = await setup(), input = receipt('ordered');
    await raw.register(taskId, input);
    await raw.ingest(taskId, { ...input, lastSequence: 2 }, [usage(2)]);
    expect(await numeric.next()).toBeUndefined();
    expect(await numeric.measurement({ runtimeTaskId: taskId, ...input }, 'step-2', 2)).toBeUndefined();
    await Promise.all(Array.from({ length: 4 }, () => raw.ingest(taskId, { ...input, lastSequence: 2 }, [state(1), usage(2)])));
    const page = await numeric.next();
    expect(page).toMatchObject({ runtimeTaskId: taskId, executionId: 'ordered', attempt: 1, incarnation: input.incarnation, payloadDigest: input.payloadDigest, after: 0, through: 2 });
    expect(page?.events).toEqual([{ sequence: 2, agentId: 'agent', occurredAt: at, capture: capture(2) }]);
    expect(await drizzleBusinessUsageSourceStore(tdb.db).next()).toEqual(page);
    expect(await numeric.measurement(page!, 'step-2', 2)).toEqual(capture(2).measurements[0]);
    expect(await numeric.measurement({ ...page!, incarnation: crypto.randomUUID() }, 'step-2', 2)).toBeUndefined();
    await expect(numeric.measurement(page!, 'step-2', 0)).rejects.toMatchObject({ kind: 'validation' });
    expect(await tdb.db.execute(sql`SELECT sequence FROM session.business_usage_events`)).toHaveLength(1);
    await expect(numeric.acknowledge(taskId, input.executionId, 3)).rejects.toMatchObject({ kind: 'conflict' });
    await expect(numeric.acknowledge(taskId, input.executionId, 1)).rejects.toMatchObject({ kind: 'conflict' });
    await numeric.acknowledge(taskId, input.executionId, 2); await numeric.acknowledge(taskId, input.executionId, 2);
    expect(await numeric.next()).toBeUndefined();
  });

  test('failure after numeric append rolls both stores back; conflicting replay cannot add new evidence', async () => {
    const { raw, numeric, taskId } = await setup(), input = receipt('atomic');
    await raw.register(taskId, input);
    const result = { reason: 'exited' as const, exitCode: 0, durationMs: 1 };
    const final = { sequence: 2, occurredAt: at, frame: { type: 'result' as const, result } };
    await expect(raw.ingest(taskId, { ...input, phase: 'finished', lastSequence: 2, result, outputBytes: 1 }, [usage(1), final])).rejects.toMatchObject({ kind: 'conflict' });
    expect(await numeric.next()).toBeUndefined();
    expect(await tdb.db.execute(sql`SELECT * FROM session.business_usage_sources`)).toHaveLength(0);
    expect(await tdb.db.execute(sql`SELECT * FROM session.business_usage_events`)).toHaveLength(0);
    expect(await raw.list(taskId, input.executionId, 0, 10)).toEqual([]);
    await raw.ingest(taskId, { ...input, lastSequence: 1 }, [usage(1)]);
    await expect(raw.ingest(taskId, { ...input, lastSequence: 2 }, [usage(2), usage(1, { ...capture(1), diagnostics: ['changed'] })])).rejects.toMatchObject({ kind: 'conflict' });
    expect((await numeric.next())?.events).toHaveLength(1);
    expect(await tdb.db.execute(sql`SELECT * FROM session.business_usage_events`)).toHaveLength(1);
  });

  test('raw consumption and expiry preserve unconsumed numbers and diagnostic-only evidence', async () => {
    const { raw, numeric, taskId } = await setup(), input = receipt('expires');
    await raw.register(taskId, input);
    const diagnostics: RunnerUsageCapture = { version: 1, measurements: [], diagnostics: ['missing-native-session'] };
    const result = { reason: 'exited' as const, exitCode: 0, durationMs: 1 };
    await raw.ingest(taskId, { ...input, phase: 'finished', lastSequence: 3, result }, [usage(1), usage(2, diagnostics), { sequence: 3, occurredAt: at, frame: { type: 'result', result } }]);
    await raw.acknowledge(taskId, input.executionId, 3); await raw.consume(taskId, input.executionId, 3);
    await tdb.db.execute(sql`UPDATE session.business_executions SET consumed_at=clock_timestamp()-interval '8 days' WHERE task_id=${taskId}`);
    expect(await raw.expire()).toBe(3);
    await expect(raw.list(taskId, input.executionId, 0, 10)).rejects.toMatchObject({ kind: 'gone' });
    const page = await drizzleBusinessUsageSourceStore(tdb.db).next();
    expect(page?.events.map((event) => event.capture)).toEqual([capture(1), diagnostics]);
    expect(await numeric.measurement(page!, 'step-1', 1)).toEqual(capture(1).measurements[0]);
    await numeric.acknowledge(taskId, input.executionId, page!.through);
    expect(await numeric.next()).toBeUndefined();
    expect(await tdb.db.execute(sql`SELECT * FROM session.business_usage_events`)).toHaveLength(2);
  });

  test('bounded source pages replay after lost ACK and rotate past a failing execution', async () => {
    const { raw, numeric, taskId } = await setup(), first = receipt('first'), second = receipt('second');
    for (const input of [first, second]) {
      await raw.register(taskId, input);
      await raw.ingest(taskId, { ...input, lastSequence: 6 }, Array.from({ length: 6 }, (_, i) => usage(i + 1)));
    }
    const page = (await numeric.next())!;
    expect(page.executionId).toBe('first'); expect(page.events.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5]);
    const other = (await numeric.next())!; expect(other.executionId).toBe('second');
    await expect(numeric.acknowledge(taskId, 'second', 6)).rejects.toMatchObject({ kind: 'conflict' });
    await numeric.acknowledge(taskId, 'second', other.through);
    expect(await drizzleBusinessUsageSourceStore(tdb.db).next()).toEqual(page);
    await numeric.acknowledge(taskId, 'first', page.through);
    const tail = (await numeric.next())!; expect(tail).toMatchObject({ executionId: 'second', after: 5, through: 6 });
    await numeric.acknowledge(taskId, tail.executionId, tail.through);
    const last = (await numeric.next())!; expect(last).toMatchObject({ executionId: 'first', after: 5, through: 6 });
    await numeric.acknowledge(taskId, 'first', 6); await numeric.acknowledge(taskId, 'first', 5);
    expect(await numeric.next()).toBeUndefined();
    await expect(numeric.acknowledge(taskId, 'first', -1)).rejects.toMatchObject({ kind: 'validation' });
    await expect(numeric.acknowledge(taskId, 'missing', 0)).rejects.toMatchObject({ kind: 'not_found' });
  });

  test('conflicting native model evidence cannot be picked arbitrarily for valuation', async () => {
    const { raw, numeric, taskId } = await setup(), input = receipt('model-conflict'); await raw.register(taskId, input);
    const first = capture(1), changed = { ...first, measurements: first.measurements.map((item) => ({ ...item, actualModel: { provider: 'other', model: 'changed', condition: null } })) };
    await raw.ingest(taskId, { ...input, lastSequence: 2 }, [usage(1, first), usage(2, changed)]);
    await expect(numeric.measurement({ runtimeTaskId: taskId, ...input }, 'step-1', 1)).rejects.toMatchObject({ kind: 'conflict' });
  });

  test('an issued page remains identical when new evidence arrives before its ACK', async () => {
    const { raw, numeric, taskId } = await setup(), input = receipt('stable-page');
    await raw.register(taskId, input); await raw.ingest(taskId, { ...input, lastSequence: 1 }, [usage(1)]);
    const first = await numeric.next();
    // Ledger may have committed this page before its source ACK is lost.
    await raw.ingest(taskId, { ...input, lastSequence: 2 }, [usage(2)]);
    expect(await drizzleBusinessUsageSourceStore(tdb.db).next()).toEqual(first);
    await numeric.acknowledge(taskId, input.executionId, first!.through);
    expect(await numeric.next()).toMatchObject({ after: 1, through: 2, events: [{ sequence: 2 }] });
  });

  test('Session public API binds the durable store without a live Runner', async () => {
    const { raw, taskId } = await setup(), input = receipt('api');
    const module = createSessionModule({ db: tdb.db, runnerAuth: { verifyRunnerToken: async () => ({ ok: false, reason: 'unused' }) },
      taskAccess: { canOpenStream: async () => false, onRunnerConnected: async () => true, onRunnerDisconnected: async () => {} }, isAdmin: async () => false,
      settings: { selfAddress: 'http://127.0.0.1', commandTimeoutMs: 10000, runnerStaleMs: 30000, replayLimit: 100 } });
    await raw.register(taskId, input); await raw.ingest(taskId, { ...input, lastSequence: 1 }, [usage(1)]);
    expect((await module.api.nextBusinessUsageSource())?.events[0]?.capture).toEqual(capture(1));
    await module.api.acknowledgeBusinessUsageSource(taskId, input.executionId, 1);
    expect(await module.api.nextBusinessUsageSource()).toBeUndefined();
    for (const worker of module.workers) await worker.stop();
  });
});
