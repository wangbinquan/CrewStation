// RFC-034: native proofs share the usage watermark and reconcile resumed steps against their original owner.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { ExecutionObservationIdentitySchema, type ExecutionObservationIdentity, type NativeUsageProof, type NativeUsageStep, type RunnerUsageCapture, type RunnerUsageMeasurement } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { drizzleUsageLedger } from '../adapters/persistence/drizzleUsageLedger';
import { nativeCaptures, nativeSteps } from '../adapters/persistence/usageLedgerTables';
import { usageIngestion } from '../application/usageIngestion';
import { nativeCaptureId, nativeRecordId } from '../domain/usageProjection';
import type { UsageLedgerStore, UsageSourcePage } from '../ports/usageLedger';
import { observabilityMigrations } from '../wiring';

const available = await testDatabaseAvailable();
let tdb: TestDatabase;
beforeAll(async () => { if (available) tdb = await createTestDatabase([observabilityMigrations]); });
afterAll(async () => { await tdb?.drop(); });
const at = '2026-09-28T00:00:00.000Z';
function step(id: string, input = '10'): NativeUsageStep { return { id, sessionId: 'root', parentSessionId: null, ancestors: [], occurredAt: at, usage: { input, output: '0', cacheRead: '0', cacheWrite: '0' }, actualModel: { provider: 'p', model: 'm', condition: null } }; }
function proof(state: NativeUsageProof['state'], patch: Partial<NativeUsageProof> = {}): NativeUsageProof {
  return { contract: 'opencode-child-steps-v1', lineageKey: 'stable-session', turn: 'turn-1', turnIndex: 0, state, root: 'root', observedAt: at,
    baseline: { kind: 'fresh', fingerprint: null }, fingerprint: state === 'complete' ? 'final' : null, sessions: 1, steps: state === 'complete' ? 1 : 0,
    emitted: state === 'complete' ? 1 : 0, baselineSteps: 0, priorRevisionGap: false, issues: [], ...patch };
}
const proofFrame = (p: NativeUsageProof): RunnerUsageCapture => ({ version: 1, measurements: [], diagnostics: [], nativeProof: p });
function numberFrame(value = step('S'), patch: Partial<RunnerUsageMeasurement> = {}): RunnerUsageCapture {
  return { version: 1, diagnostics: [], measurements: [{ recordId: nativeRecordId(value), revision: 1, observedAt: at, occurredAt: at, actualModel: value.actualModel,
    adapterVersion: 'test/native', reporting: 'delta', inclusion: 'self', coverage: 'complete', validity: 'valid', coveredThroughTurn: null,
    scope: { root: 'root', session: value.sessionId, parentSession: value.parentSessionId, ancestors: value.ancestors, turn: 'turn-1', turnIndex: 0, level: 'request' },
    usage: value.usage, basis: { kind: 'invocation' }, ...patch }] };
}
function setup() {
  const identity = ExecutionObservationIdentitySchema.parse({ projectId: Bun.randomUUIDv7(), taskId: Bun.randomUUIDv7(), subtaskId: Bun.randomUUIDv7(), executionId: Bun.randomUUIDv7(), executionGeneration: 1 });
  const store = drizzleUsageLedger(tdb.db), ingest = usageIngestion(store), scope = { projectId: identity.projectId, taskId: identity.taskId };
  let sequence = 0;
  const input = async (frames: RunnerUsageCapture[], who = identity, sourceId = 'runner'): Promise<UsageSourcePage> => {
    const nextCursor = 'page:' + ++sequence;
    return { ...scope, sourceId, expectedCursor: await store.cursor(scope, sourceId), nextCursor,
      events: frames.flatMap((frame, index) => frame.measurements.map(({ actualModel, ...measurement }) => ({ eventId: `${nextCursor}:${index}:${measurement.recordId}`, measurement: { ...measurement, identity: who, sourceId, kind: 'usage' as const, modelRef: actualModel ? jsonHash(actualModel) : null } }))),
      native: frames.map((capture) => ({ identity: who, capture })) };
  };
  const send = async (frames: RunnerUsageCapture[], who = identity, sourceId = 'runner') => ingest(await input(frames, who, sourceId));
  const summary = async (who = identity, sourceId = 'runner', turn = 'turn-1') => (await tdb.db.select().from(nativeCaptures).where(eq(nativeCaptures.id, nativeCaptureId(who, sourceId, turn))).limit(1))[0]?.summary;
  return { identity, scope, store, input, send, summary, ingest };
}

describe.skipIf(!available)('RFC-034 native proof ledger', () => {
  test('pending, numeric evidence and final proof commit in order and frozen snapshots retain their own gap', async () => {
    const f = setup();
    await f.send([proofFrame(proof('pending')), numberFrame(), numberFrame(step('T', '5'))]);
    const before = await f.store.snapshot(f.scope, { limit: 1 }, Date.parse(at), 0);
    expect(before.captureIncomplete).toBe(true); expect(before.nextCursor).not.toBeNull();
    expect(await f.summary()).toMatchObject({ state: 'pending', receivedSteps: 2 });
    const final = await f.input([proofFrame(proof('complete', { steps: 2, emitted: 2 }))]);
    await f.ingest(final);
    const current = await f.store.changes(f.scope, 0, 20);
    expect(current.captureIncomplete).toBe(false); expect(current.persistedThrough).toBeGreaterThan(before.snapshotThrough);
    expect(await f.summary()).toMatchObject({ state: 'complete', receivedSteps: 2, issues: [] });
    const next = await f.store.snapshot(f.scope, { snapshotId: before.snapshotId, cursor: before.nextCursor!, limit: 1 }, Date.parse(at) + 1, 0);
    expect(next.captureIncomplete).toBe(true); expect(next.snapshotThrough).toBe(before.snapshotThrough);
    await f.ingest(final);
    expect((await f.store.changes(f.scope, 0, 20)).persistedThrough).toBe(current.persistedThrough);
  });
  test('proof-only changes advance the public watermark and missing numerical frames cannot claim completion', async () => {
    const f = setup(); await f.send([proofFrame(proof('pending'))]);
    const pending = await f.store.changes(f.scope, 0, 20);
    expect(pending).toMatchObject({ items: [], persistedThrough: 1, captureIncomplete: true });
    await f.send([proofFrame(proof('complete'))]);
    expect(await f.summary()).toMatchObject({ state: 'partial', issues: ['native-evidence-incomplete'] });
    await f.send([numberFrame()]);
    expect(await f.summary()).toMatchObject({ state: 'complete' });
    expect((await f.store.changes(f.scope, pending.persistedThrough, 20)).captureIncomplete).toBe(false);
  });
  test('legacy usage without a matching turn proof stays incomplete and an unrelated complete turn cannot hide it', async () => {
    const f = setup(); await f.send([numberFrame()]);
    await f.send([proofFrame(proof('pending', { turn: 'other' })), proofFrame(proof('complete', { turn: 'other', steps: 0, emitted: 0 }))]);
    expect((await f.store.changes(f.scope, 0, 20)).captureIncomplete).toBe(true);
    expect(await f.summary(f.identity, 'runner', 'other')).toMatchObject({ state: 'complete', receivedSteps: 0 });
  });
  test('a checkpoint failure rolls back numerical values, native proof, history and cursor together', async () => {
    const f = setup(), input = await f.input([proofFrame(proof('pending')), numberFrame(), proofFrame(proof('complete'))]);
    const broken: UsageLedgerStore = { ...f.store, change: (scope, sourceId, work) => f.store.change(scope, sourceId, (tx) => work({ ...tx,
      advance: async (...args) => { await tx.advance(...args); throw new Error('checkpoint failed'); },
    })) };
    await expect(usageIngestion(broken)(input)).rejects.toThrow('checkpoint failed');
    expect(await f.summary()).toBeUndefined(); expect(await f.store.cursor(f.scope, 'runner')).toBeNull();
    expect(await f.store.changes(f.scope, 0, 20)).toMatchObject({ items: [], persistedThrough: 0, captureIncomplete: false });
    await f.ingest(input); expect(await f.summary()).toMatchObject({ state: 'complete' });
  });
  for (const lateOwner of [false, true]) test(`between-execution revisions mark their original owner and never become current-turn usage; late owner=${lateOwner}`, async () => {
    const f = setup(), resumed: ExecutionObservationIdentity = { ...f.identity, executionId: Bun.randomUUIDv7() as ExecutionObservationIdentity['executionId'], executionGeneration: 2 };
    const old = [proofFrame(proof('pending')), numberFrame(), proofFrame(proof('complete'))];
    if (!lateOwner) await f.send(old);
    const earlier = !lateOwner ? await f.store.snapshot(f.scope, { limit: 20 }, Date.parse(at), 0) : undefined;
    const patch = { turn: 'turn-2', turnIndex: 1, baseline: { kind: 'resume' as const, fingerprint: 'baseline15' }, baselineSteps: 1 };
    const value = numberFrame(step('T', '3')); value.measurements[0]!.scope!.turn = 'turn-2'; value.measurements[0]!.scope!.turnIndex = 1;
    await f.send([proofFrame(proof('pending', patch)), value, { version: 1, measurements: [], diagnostics: [], nativeBaseline: {
      lineageKey: 'stable-session', turn: 'turn-2', root: 'root', offset: 0, steps: [{ before: step('S', '15'), after: step('S', '15'), afterObserved: true }],
    } }, proofFrame(proof('complete', { ...patch, steps: 2, emitted: 1 }))], resumed, 'resumed');
    if (lateOwner) { expect(await f.summary(resumed, 'resumed', 'turn-2')).toMatchObject({ state: 'partial', unresolvedBaselineSteps: 1 }); await f.send(old); }
    expect(await f.summary()).toMatchObject({ state: 'partial', historicalRevisionGap: true });
    expect(await f.summary(resumed, 'resumed', 'turn-2')).toMatchObject({ state: 'partial', unresolvedBaselineSteps: 0, revisedBaselineSteps: 1 });
    const current = await f.store.changes(f.scope, 0, 20);
    expect(current.captureIncomplete).toBe(true);
    expect(current.items.filter((r) => r.kind === 'usage').reduce((sum, r) => sum + BigInt(r.projection.contribution.input ?? '0'), 0n)).toBe(13n);
    if (earlier) expect(earlier.captureIncomplete).toBe(false);
  });
  test('duplicate baseline positions roll back and a final proof cannot cover usage from a different root', async () => {
    const f = setup(), patch = { baseline: { kind: 'resume' as const, fingerprint: 'base' }, baselineSteps: 2 };
    await f.send([proofFrame(proof('pending', patch))]);
    const baseline: RunnerUsageCapture = { version: 1, measurements: [], diagnostics: [], nativeBaseline: {
      lineageKey: 'stable-session', turn: 'turn-1', root: 'root', offset: 0, steps: Array.from({ length: 2 }, () => ({ before: step('S'), after: step('S'), afterObserved: true })),
    } };
    await expect(f.send([baseline])).rejects.toMatchObject({ kind: 'conflict' });
    expect(await f.summary()).toMatchObject({ receivedBaselineSteps: 0, state: 'pending' });
    const other = setup(), number = numberFrame({ ...step('X'), sessionId: 'other' }); number.measurements[0]!.scope!.root = 'other';
    await other.send([proofFrame(proof('pending')), number, proofFrame(proof('complete'))]);
    expect(await other.summary()).toMatchObject({ state: 'partial', issues: ['native-root-changed'] });
    expect((await other.store.changes(other.scope, 0, 20)).captureIncomplete).toBe(true);
  });
  test('ambiguous original owners keep the resumed baseline unresolved', async () => {
    const f = setup(), other = { ...f.identity, executionGeneration: 2 };
    const originals = [proofFrame(proof('pending')), numberFrame(), proofFrame(proof('complete'))];
    await f.send(originals); await f.send(originals, other, 'other-owner');
    const resumed = { ...f.identity, executionGeneration: 3 }, patch = { baseline: { kind: 'resume' as const, fingerprint: 'base' }, baselineSteps: 1 };
    await f.send([proofFrame(proof('pending', patch)), { version: 1, measurements: [], diagnostics: [], nativeBaseline: {
      lineageKey: 'stable-session', turn: 'turn-1', root: 'root', offset: 0, steps: [{ before: step('S'), after: step('S'), afterObserved: true }],
    } }, proofFrame(proof('complete', { ...patch, steps: 1, emitted: 0 }))], resumed, 'resume-ambiguous');
    expect(await f.summary(resumed, 'resume-ambiguous')).toMatchObject({ state: 'partial', unresolvedBaselineSteps: 1, revisedBaselineSteps: 0 });
  });
  test('unchanged resumed evidence resolves to one owner while missing after evidence never invents deletion', async () => {
    const f = setup(); await f.send([proofFrame(proof('pending')), numberFrame(), proofFrame(proof('complete'))]);
    const resumed = { ...f.identity, executionGeneration: 2 }, patch = { turn: 'turn-2', turnIndex: 1, baseline: { kind: 'resume' as const, fingerprint: 'before' }, baselineSteps: 1 };
    await f.send([proofFrame(proof('pending', patch)), { version: 1, measurements: [], diagnostics: [], nativeBaseline: {
      lineageKey: 'stable-session', turn: 'turn-2', root: 'root', offset: 0, steps: [{ before: step('S'), after: null, afterObserved: false }],
    } }, proofFrame(proof('partial', { ...patch, steps: 0, emitted: 0, issues: ['native-store-unavailable'] }))], resumed, 'resumed');
    expect(await f.summary()).toMatchObject({ state: 'complete', historicalRevisionGap: false });
    expect(await f.summary(resumed, 'resumed', 'turn-2')).toMatchObject({ revisedBaselineSteps: 0, unresolvedBaselineSteps: 0 });
  });
  // A scanning budget cannot cap the number of stdout measurements already persisted.
  test('the 10001st stdout step advances its page and a bounded final proof stays partial', async () => {
    const f = setup(); await f.send([proofFrame(proof('pending'))]);
    const captureId = nativeCaptureId(f.identity, 'runner', 'turn-1'), taskKey = jsonHash(f.scope);
    for (let offset = 0; offset < 10000; offset += 1000) await tdb.db.insert(nativeSteps).values(Array.from({ length: 1000 }, (_, index) => ({
      captureId, taskKey, recordId: `prior:${offset + index}`, nativeKey: `native:${offset + index}`, root: 'root', revision: 1, fingerprint: 'prior',
    })));
    await f.send([numberFrame(step('new-10001'))]);
    expect(await f.summary()).toMatchObject({ state: 'pending', receivedSteps: 10001 });
    expect(await f.store.cursor(f.scope, 'runner')).toBe('page:2');
    await f.send([proofFrame(proof('partial', { issues: ['native-step-budget'], steps: 10000, emitted: 10000 }))]);
    await f.send([numberFrame(step('new-10002'))]);
    expect(await f.summary()).toMatchObject({ state: 'partial', receivedSteps: 10002, issues: ['native-step-budget'] });
    expect(await f.store.cursor(f.scope, 'runner')).toBe('page:4');
  });

});
