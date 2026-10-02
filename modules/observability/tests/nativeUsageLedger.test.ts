// RFC-034: native proofs share the usage watermark and reconcile resumed steps against their original owner.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { ExecutionObservationIdentitySchema, type ExecutionObservationIdentity, type NativeUsageProof, type NativeUsageStep, type RunnerUsageCapture, type RunnerUsageMeasurement, type RunnerUsageSourcePage, type Actor, type SaveTokenPrice } from '@crewstation/contracts';
import { fixedClock, jsonHash } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { connectDatabase, type Database } from '@crewstation/persistence';
import { drizzleExecutionPricing, drizzleTokenPriceStore } from '../adapters/persistence/drizzleTokenPricing';
import { executionValuations, valueRunnerUsagePage } from '../application/executionValuations';
import { tokenPricingUseCases } from '../application/tokenPricing';
import { drizzleExecutionValuations, drizzleUsageLedger } from '../adapters/persistence/drizzleUsageLedger';
import { nativeCaptures, nativeSteps } from "../adapters/persistence/tables";
import { runnerUsageReconciliation, usageIngestion } from '../application/usageIngestion';
import { nativeCaptureId, nativeRecordId } from '../domain/usageProjection';
import type { UsageLedgerStore, UsageSourcePage, RunnerUsageSource } from '../ports/usageLedger';
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
function setup(db: Database = tdb.db) {
  const identity = ExecutionObservationIdentitySchema.parse({ projectId: Bun.randomUUIDv7(), taskId: Bun.randomUUIDv7(), subtaskId: Bun.randomUUIDv7(), executionId: Bun.randomUUIDv7(), executionGeneration: 1 });
  const store = drizzleUsageLedger(db), ingest = usageIngestion(store), scope = { projectId: identity.projectId, taskId: identity.taskId };
  let sequence = 0;
  const input = async (frames: RunnerUsageCapture[], who = identity, sourceId = 'runner'): Promise<UsageSourcePage> => {
    const nextCursor = 'page:' + ++sequence;
    return { ...scope, sourceId, expectedCursor: await store.cursor(scope, sourceId), nextCursor,
      events: frames.flatMap((frame, index) => frame.measurements.map(({ actualModel, ...measurement }) => ({ eventId: `${nextCursor}:${index}:${measurement.recordId}`, measurement: { ...measurement, identity: who, sourceId, kind: 'usage' as const, modelRef: actualModel ? jsonHash(actualModel) : null } }))),
      native: frames.map((capture) => ({ identity: who, capture })) };
  };
  const send = async (frames: RunnerUsageCapture[], who = identity, sourceId = 'runner') => ingest(await input(frames, who, sourceId));
  const summary = async (who = identity, sourceId = 'runner', turn = 'turn-1') => (await tdb.db.select().from(nativeCaptures).where(eq(nativeCaptures.id, nativeCaptureId(who, sourceId, turn))).limit(1))[0]?.summary;
  return { identity, scope, store, input, send, summary, ingest, db };
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


function orderedResume(value: NativeUsageStep, sequence: number, patch: Partial<NativeUsageProof> = {}): RunnerUsageCapture[] {
  const turn = 'resume-' + sequence, baseline = { kind: 'resume' as const, fingerprint: 'baseline-' + sequence, order: { epoch: 'native-db', sequence: sequence - 1 } };
  const common = { turn, turnIndex: sequence, baseline, baselineSteps: 1, ...patch };
  return [proofFrame(proof('pending', common)), { version: 1, measurements: [], diagnostics: [], nativeBaseline: {
    lineageKey: common.lineageKey ?? 'stable-session', turn, root: common.root ?? 'root', offset: 0,
    steps: [{ before: value, after: value, afterObserved: true }],
  } }, proofFrame(proof('complete', { ...common, steps: 1, emitted: 0, order: { epoch: 'native-db', sequence } }))];
}
const orderedOwner = (value = step('S')) => [proofFrame(proof('pending')), numberFrame(value), proofFrame(proof('complete', { order: { epoch: 'native-db', sequence: 1 } }))];

describe.skipIf(!available)('RFC-034 historical repair projections', () => {
  for (const amount of ['15', '8']) test(`correction replaces the original owner with ${amount}, preserving raw evidence and old snapshots`, async () => {
    const f = setup(), originalFrames = orderedOwner(); originalFrames.splice(2, 0, numberFrame(step('U', '0')));
    Object.assign(originalFrames.at(-1)!.nativeProof!, { steps: 2, emitted: 2 }); await f.send(originalFrames);
    const before = await f.store.snapshot(f.scope, { limit: 1 }, Date.parse(at), 0);
    const resumed = { ...f.identity, executionGeneration: 2 };
    const frames = orderedResume(step('S', amount), 3), currentStep = numberFrame(step('T', '3'));
    Object.assign(currentStep.measurements[0]!.scope!, { turn: 'resume-3', turnIndex: 3 }); frames.splice(1, 0, currentStep);
    Object.assign(frames.at(-1)!.nativeProof!, { steps: 2, emitted: 1 }); await f.send(frames, resumed, 'resumed');
    const current = await f.store.snapshot(f.scope, { limit: 20 }, Date.parse(at) + 1, 0);
    const old = current.items.find((r) => r.kind === 'usage' && r.recordId === nativeRecordId(step('S')))!;
    expect(old.kind === 'usage' && old.projection.contribution.input).toBe(amount);
    expect(old.kind === 'usage' && old.usage.input).toBe('10');
    expect(old.revision).toBe(1);
    expect(current.items.filter((r) => r.kind === 'usage').reduce((sum, r) => sum + BigInt(r.projection.contribution.input!), 0n)).toBe(BigInt(amount) + 3n);
    expect(current.items.find((r) => r.sourceId === 'resumed')).toMatchObject({ identity: resumed, projection: { contribution: { input: '3' } } });
    expect(await f.summary(resumed, 'resumed', 'resume-3')).toMatchObject({ correctedBaselineSteps: 1, revisedBaselineSteps: 0 });
    expect(await f.summary()).toMatchObject({ historicalRevisionGap: false });
    const frozen = await f.store.snapshot(f.scope, { snapshotId: before.snapshotId, cursor: before.nextCursor!, limit: 10 }, Date.parse(at) + 1, 0);
    expect(frozen.snapshotThrough).toBe(before.snapshotThrough);
    const original = [...before.items, ...frozen.items].find((r) => r.kind === 'usage' && r.recordId === nativeRecordId(step('S')))!;
    expect(original.kind === 'usage' && original.projection.contribution.input).toBe('10');
  });
  test('same-value newer evidence advances order and older numeric changes cannot roll it back', async () => {
    const f = setup(); await f.send(orderedOwner()); const resumed = { ...f.identity, executionGeneration: 2 };
    await f.send(orderedResume(step('S', '10'), 5), resumed, 'newer-same');
    await f.send(orderedResume(step('S', '15'), 3), resumed, 'older-different');
    const current = await f.store.snapshot(f.scope, { limit: 20 }, Date.parse(at), 0);
    expect(current.items[0]?.kind === 'usage' && current.items[0].projection.contribution.input).toBe('10');
    expect(await f.summary(resumed, 'older-different', 'resume-3')).toMatchObject({ revisedBaselineSteps: 0, correctedBaselineSteps: 1 });
  });
  test('late native model metadata enables correction without consuming the native revision or changing its numbers', async () => {
    const f = setup(); await f.send(orderedOwner({ ...step('S'), actualModel: null }));
    const resumed = { ...f.identity, executionGeneration: 2 };
    await f.send(orderedResume(step('S', '15'), 3), resumed, 'resumed');
    expect(await f.summary(resumed, 'resumed', 'resume-3')).toMatchObject({ revisedBaselineSteps: 1 });
    await f.send([numberFrame(step('S'), { revision: 2 })]);
    const current = await f.store.snapshot(f.scope, { limit: 20 }, Date.parse(at), 0);
    expect(current.items[0]).toMatchObject({ revision: 2, usage: { input: '10' }, projection: { contribution: { input: '15' }, modelRevision: 2 } });
    expect(await f.summary(resumed, 'resumed', 'resume-3')).toMatchObject({ revisedBaselineSteps: 0, correctedBaselineSteps: 1 });
    await f.send([numberFrame(step('S'), { revision: 3 })]);
    expect((await f.store.snapshot(f.scope, { limit: 20 }, Date.parse(at), 0)).items[0]).toMatchObject({ revision: 3, projection: { contribution: { input: '15' } } });
  });
});


describe.skipIf(!available)('RFC-034 correction boundaries and recovery', () => {
  test('a late original owner triggers repair, but a second original owner removes the ambiguous overlay', async () => {
    const f = setup(), resumed = { ...f.identity, executionGeneration: 2 };
    await f.send(orderedResume(step('S', '15'), 3), resumed, 'resumed');
    expect(await f.summary(resumed, 'resumed', 'resume-3')).toMatchObject({ unresolvedBaselineSteps: 1 });
    await f.send(orderedOwner());
    expect((await f.store.snapshot(f.scope, { limit: 20 }, Date.parse(at), 0)).items[0]).toMatchObject({ projection: { contribution: { input: '15' } } });
    await f.send(orderedOwner(), { ...f.identity, executionGeneration: 3 }, 'ambiguous');
    expect(await f.summary(resumed, 'resumed', 'resume-3')).toMatchObject({ unresolvedBaselineSteps: 1, correctedBaselineSteps: 0 });
    const latest = await f.store.snapshot(f.scope, { limit: 20 }, Date.parse(at), 0);
    expect(latest.items.find((r) => r.sourceId === 'runner')).toMatchObject({ projection: { contribution: { input: '10' } } });
    expect(await f.summary()).toMatchObject({ historicalRevisionGap: true });
    expect(await drizzleExecutionValuations(f.db).pendingNativeRepairs(f.scope, 200)).toHaveLength(1);
  });
  test('same-order conflicts retain the accepted numbers and a failed checkpoint rolls all corrections back', async () => {
    const f = setup(), resumed = { ...f.identity, executionGeneration: 2 }; await f.send(orderedOwner());
    const input = await f.input(orderedResume(step('S', '15'), 3), resumed, 'resumed');
    const broken: UsageLedgerStore = { ...f.store, change: (scope, source, work) => f.store.change(scope, source, (tx) => work({ ...tx,
      advance: async (...args) => { await tx.advance(...args); throw new Error('repair checkpoint failed'); },
    })) };
    await expect(usageIngestion(broken)(input)).rejects.toThrow('repair checkpoint failed');
    expect(await f.store.cursor(f.scope, 'resumed')).toBeNull();
    expect(await drizzleExecutionValuations(f.db).pendingNativeRepairs(f.scope, 200)).toHaveLength(0);
    await f.ingest(input); const before = await f.store.changes(f.scope, 0, 20); await f.ingest(input);
    expect((await f.store.changes(f.scope, 0, 20)).persistedThrough).toBe(before.persistedThrough);
    await f.send(orderedResume(step('S', '99'), 3), resumed, 'conflicting-order');
    expect((await f.store.snapshot(f.scope, { limit: 20 }, Date.parse(at), 0)).items[0]).toMatchObject({ projection: { contribution: { input: '15' } } });
    expect(await f.summary(resumed, 'conflicting-order', 'resume-3')).toMatchObject({ revisedBaselineSteps: 1 });
    expect(await f.summary()).toMatchObject({ historicalRevisionGap: true });
  });
  for (const kind of ['epoch', 'model', 'path', 'unknown', 'deleted', 'unvisited', 'lineage', 'invocation'] as const) test(`${kind} gaps cannot invent an original correction`, async () => {
    const f = setup(), original = orderedOwner();
    if (kind === 'invocation') original[1]!.measurements[0]!.basis = { kind: 'native-session', lineageKey: 'stable-session', baseline: { input: '0', output: '0', cacheRead: '0', cacheWrite: '0' } };
    await f.send(original); const resumed = { ...f.identity, executionGeneration: 2 };
    const frames = orderedResume(step('S', '15'), 3), last = frames.at(-1)!.nativeProof!, history = frames[1]!.nativeBaseline!.steps[0]!;
    if (kind === 'epoch') { frames[0]!.nativeProof!.baseline.order!.epoch = 'new-epoch'; last.baseline.order!.epoch = 'new-epoch'; last.order!.epoch = 'new-epoch'; }
    if (kind === 'model') history.after!.actualModel!.model = 'different';
    if (kind === 'path') { history.after!.parentSessionId = 'other'; history.after!.ancestors = ['other']; }
    if (kind === 'unknown') history.after!.usage.cacheRead = null;
    if (kind === 'deleted' || kind === 'unvisited') { history.after = null; history.afterObserved = kind === 'deleted'; }
    if (kind === 'lineage') { frames[0]!.nativeProof!.lineageKey = 'other-lineage'; last.lineageKey = 'other-lineage'; frames[1]!.nativeBaseline!.lineageKey = 'other-lineage'; }
    await f.send(frames, resumed, 'resumed');
    expect((await f.store.snapshot(f.scope, { limit: 20 }, Date.parse(at), 0)).items[0]).toMatchObject({ projection: { contribution: { input: '10' } } });
    expect(await drizzleExecutionValuations(f.db).pendingNativeRepairs(f.scope, 200)).toHaveLength(0);
  });
  test('a proof whose only gap is a repaired historical revision becomes complete without rewriting that proof', async () => {
    const f = setup(); await f.send(orderedOwner()); const resumed = { ...f.identity, executionGeneration: 2 };
    const frames = orderedResume(step('S', '15'), 3); frames[1]!.nativeBaseline!.steps[0]!.before = step('S');
    Object.assign(frames.at(-1)!.nativeProof!, { state: 'partial', issues: ['native-prior-revision-gap'], priorRevisionGap: true });
    await f.send(frames, resumed, 'resumed');
    expect(await f.summary(resumed, 'resumed', 'resume-3')).toMatchObject({ state: 'complete', issues: [], correctedBaselineSteps: 1, proof: { state: 'partial', priorRevisionGap: true } });
    expect((await f.store.changes(f.scope, 0, 20)).captureIncomplete).toBe(false);
  });
});

function repairValuation(f: ReturnType<typeof setup>) {
  const clock = fixedClock(at), pricing = drizzleExecutionPricing(f.db), store = drizzleExecutionValuations(f.db);
  const profile = { id: Bun.randomUUIDv7(), revision: 1, protocol: 'opencode' as const };
  const prices = tokenPricingUseCases({ store: drizzleTokenPriceStore(f.db), profiles: { list: async () => [{ ...profile, name: 'native', model: 'configured-default' }] }, clock });
  const actor: Actor = { isAdmin: true, userId: '01a0bf5d-8f4b-7793-867c-efd7527b386b' as Actor['userId'] };
  const price: SaveTokenPrice = { expectedRevision: 0, requestKey: 'native-price-1', profileRevision: 1, protocol: 'opencode', provider: 'p', model: 'm', condition: null, currency: 'CNY',
    rates: { input: '2', output: '0', cacheRead: '0', cacheWrite: '0' }, effectiveFrom: at, sourceNote: 'original CNY price' };
  const source: RunnerUsageSource = { next: async () => undefined, resolve: async () => f.identity, acknowledge: async () => {}, measurement: async () => { throw new Error('Do not fetch an old owner from the current Runner source'); } };
  const sourcePage: RunnerUsageSourcePage = { runtimeTaskId: f.identity.taskId, executionId: f.identity.executionId, attempt: 1, incarnation: 'incarnation', payloadDigest: 'digest', after: 0, through: 0, events: [] };
  const page: UsageSourcePage = { ...f.scope, sourceId: 'repair-only', expectedCursor: null, nextCursor: 'page:1', events: [] };
  const value = executionValuations({ store, pricing, clock });
  const drain = () => valueRunnerUsagePage({ store, source, value })(sourcePage, page);
  return { clock, pricing, store, profile, prices, actor, price, value, source, sourcePage, page, drain };
}
describe.skipIf(!available)('RFC-034 original CNY price repair', () => {
  test('repair uses the accepted original CNY price with one DB connection, survives response loss and does not add tokens', async () => {
    const db = connectDatabase(tdb.url, { max: 1 });
    try {
      const f = setup(db.db), v = repairValuation(f), version = await v.prices.savePrice(v.actor, v.profile.id, v.price);
      await v.pricing.accept({ identity: f.identity, profile: v.profile }, v.clock.now());
      await f.send(orderedOwner()); const resumed = { ...f.identity, executionGeneration: 2 };
      await v.prices.savePrice(v.actor, v.profile.id, { ...v.price, requestKey: 'native-price-2', expectedRevision: 1, effectiveFrom: '2026-09-28T01:00:00.000Z', rates: { ...v.price.rates, input: '999' } });
      await f.send(orderedResume(step('S', '15'), 3), resumed, 'resumed');
      const lost = valueRunnerUsagePage({ store: v.store, source: v.source, value: async (input) => { await v.value(input); throw new Error('response lost'); } });
      await expect(lost(v.sourcePage, v.page)).rejects.toThrow('response lost');
      await v.drain(); await v.drain();
      const current = await f.store.snapshot(f.scope, { limit: 20 }, Date.parse(at), 0);
      expect(current.items.filter((r) => r.kind === 'usage')).toHaveLength(1);
      expect(current.items.find((r) => r.kind === 'valuation')).toMatchObject({ currency: 'CNY', amountDecimal: '0.00003', priceVersionRef: version.id, usageRevision: 2, valuationRevision: 1 });
      expect(await f.store.cursor(f.scope, 'resumed')).toBe('page:2');
      expect(await v.store.pendingNativeRepairs(f.scope, 200)).toHaveLength(0);
      await expect(v.store.pendingNativeRepairs(f.scope, 201)).rejects.toThrow('Invalid');
    } finally { await db.close(); }
  });
  test('selected model evidence survives a later rejected model and an unknown-model repair remains unpriced', async () => {
    const f = setup(), v = repairValuation(f); await v.prices.savePrice(v.actor, v.profile.id, v.price);
    await v.pricing.accept({ identity: f.identity, profile: v.profile }, v.clock.now()); await f.send(orderedOwner());
    await f.send([numberFrame({ ...step('S'), actualModel: { provider: 'other', model: 'wrong', condition: null } }, { revision: 3 })]);
    const resumed = { ...f.identity, executionGeneration: 2 }; await f.send(orderedResume(step('S', '15'), 3), resumed, 'resumed');
    await v.drain();
    expect((await f.store.snapshot(f.scope, { limit: 20 }, Date.parse(at), 0)).items.find((r) => r.kind === 'valuation')).toMatchObject({ availability: 'priced', amountDecimal: '0.00003', completeness: 'partial' });
    const unknown = setup(), uv = repairValuation(unknown); await unknown.send(orderedOwner({ ...step('S'), actualModel: null }));
    await unknown.send(orderedResume({ ...step('S', '15'), actualModel: null }, 3), { ...unknown.identity, executionGeneration: 2 }, 'resumed');
    await uv.drain();
    expect((await unknown.store.snapshot(unknown.scope, { limit: 20 }, Date.parse(at), 0)).items.find((r) => r.kind === 'valuation')).toMatchObject({ availability: 'unpriced', amountDecimal: null, currency: 'CNY' });
  });
  test('old selected-model metadata can arrive below the highest revision and still revalue the repaired numbers', async () => {
    const f = setup(), v = repairValuation(f); await v.prices.savePrice(v.actor, v.profile.id, v.price);
    await v.pricing.accept({ identity: f.identity, profile: v.profile }, v.clock.now()); await f.send(orderedOwner({ ...step('S'), actualModel: null }));
    await f.send([numberFrame({ ...step('S'), actualModel: { provider: 'other', model: 'wrong', condition: null } }, { revision: 3, validity: 'invalid-final' })]);
    await f.send(orderedResume(step('S', '15'), 3), { ...f.identity, executionGeneration: 2 }, 'resumed');
    await f.send([numberFrame(step('S'), { revision: 2 })]); await v.drain();
    const current = await f.store.snapshot(f.scope, { limit: 20 }, Date.parse(at), 0);
    expect(current.items.find((r) => r.kind === 'usage')).toMatchObject({ projection: { observedRevision: 3, modelRevision: 2, contribution: { input: '15' } } });
    expect(current.items.find((r) => r.kind === 'valuation')).toMatchObject({ availability: 'priced', amountDecimal: '0.00003' });
  });
});


describe.skipIf(!available)('RFC-034 bounded repair valuation drain', () => {
  test('201 repairs stop at 200 per pass and remain pending until the final valuation is durable', async () => {
    const f = setup(), v = repairValuation(f);
    const values = Array.from({ length: 201 }, (_, i) => step('S' + i));
    const originals: RunnerUsageCapture[] = [proofFrame(proof('pending'))];
    for (let offset = 0; offset < values.length; offset += 100) originals.push({ version: 1, diagnostics: [], measurements: values.slice(offset, offset + 100).map((s) => numberFrame(s).measurements[0]!) });
    originals.push(proofFrame(proof('complete', { emitted: values.length, steps: values.length, order: { epoch: 'native-db', sequence: 1 } })));
    await f.send(originals);
    const resumed = { ...f.identity, executionGeneration: 2 }, patch = { turn: 'resume', turnIndex: 1, baseline: { kind: 'resume' as const, fingerprint: 'before', order: { epoch: 'native-db', sequence: 2 } }, baselineSteps: values.length };
    const history: RunnerUsageCapture[] = [proofFrame(proof('pending', patch))];
    for (let offset = 0; offset < values.length; offset += 100) history.push({ version: 1, measurements: [], diagnostics: [], nativeBaseline: {
      lineageKey: 'stable-session', turn: 'resume', root: 'root', offset, steps: values.slice(offset, offset + 100).map((before) => ({ before, after: { ...before, usage: { ...before.usage, input: '15' } }, afterObserved: true })),
    } });
    history.push(proofFrame(proof('complete', { ...patch, emitted: 0, steps: values.length, order: { epoch: 'native-db', sequence: 3 } })));
    await f.send(history, resumed, 'resumed');
    expect(await v.store.pendingNativeRepairs(f.scope, 200)).toHaveLength(200);
    await expect(v.drain()).rejects.toThrow('继续处理中');
    expect(await v.store.pendingNativeRepairs(f.scope, 200)).toHaveLength(1);
    await v.drain(); expect(await v.store.pendingNativeRepairs(f.scope, 200)).toHaveLength(0);
    const snapshot = await f.store.snapshot(f.scope, { limit: 500 }, Date.parse(at), 0);
    expect(snapshot.items.filter((r) => r.kind === 'valuation')).toHaveLength(201);
    expect(snapshot.items.filter((r) => r.kind === 'usage').reduce((sum, r) => sum + BigInt(r.projection.contribution.input!), 0n)).toBe(3015n);
  }, 60000);
  test('Runner ACK waits for original repair valuation, including retry after a pricing failure', async () => {
    const f = setup(), v = repairValuation(f), originals = orderedOwner();
    await v.prices.savePrice(v.actor, v.profile.id, v.price); await v.pricing.accept({ identity: f.identity, profile: v.profile }, v.clock.now());
    const frames = [originals, orderedResume(step('S', '15'), 3)];
    const pages: RunnerUsageSourcePage[] = frames.map((rows, index) => ({ runtimeTaskId: f.identity.taskId, executionId: f.identity.executionId, attempt: index + 1,
      incarnation: 'native-' + index, payloadDigest: 'payload', after: 0, through: rows.length,
      events: rows.map((capture, i) => ({ sequence: i + 1, agentId: 'agent', occurredAt: at, capture })) }));
    let pageIndex = 0, unavailable = false; const acknowledgements: number[] = [];
    const source: RunnerUsageSource = { next: async () => pages[pageIndex], resolve: async (page) => ({ ...f.identity, executionGeneration: page.attempt }),
      measurement: async (page, record, revision) => frames[page.attempt - 1]!.flatMap((r) => r.measurements).find((r) => r.recordId === record && r.revision === revision),
      acknowledge: async () => { acknowledgements.push(pageIndex++); if (pageIndex === 1) unavailable = true; } };
    const value = executionValuations({ store: v.store, clock: v.clock, pricing: { ...v.pricing, price: async (...args) => {
      if (unavailable) throw new Error('price temporarily unavailable'); return v.pricing.price(...args);
    } } });
    const reconcile = runnerUsageReconciliation({ source, store: f.store, value: valueRunnerUsagePage({ source, store: v.store, value }), logger: { warn: () => {} } });
    expect(await reconcile()).toBe(1); expect(acknowledgements).toEqual([0]);
    expect(await v.store.pendingNativeRepairs(f.scope, 200)).toHaveLength(1);
    unavailable = false; expect(await reconcile()).toBe(1); expect(acknowledgements).toEqual([0, 1]);
    const current = await f.store.snapshot(f.scope, { limit: 20 }, Date.parse(at), 0);
    expect(current.items.filter((r) => r.kind === 'usage')).toHaveLength(1);
    expect(current.items.find((r) => r.kind === 'valuation')).toMatchObject({ amountDecimal: '0.00003', usageRevision: 2 });
  });
  test('a previously accepted unknown-model repair retains corrected numbers when the original model becomes known', async () => {
    const f = setup(), v = repairValuation(f); await v.prices.savePrice(v.actor, v.profile.id, v.price);
    await v.pricing.accept({ identity: f.identity, profile: v.profile }, v.clock.now());
    await f.send(orderedOwner({ ...step('S'), actualModel: null }));
    const resumed = { ...f.identity, executionGeneration: 2 };
    await f.send(orderedResume({ ...step('S', '15'), actualModel: null }, 3), resumed, 'resumed'); await v.drain();
    await f.send([numberFrame(step('S'), { revision: 2 })]); await v.drain();
    const current = await f.store.snapshot(f.scope, { limit: 20 }, Date.parse(at), 0);
    expect(current.items.find((r) => r.kind === 'usage')).toMatchObject({ projection: { contribution: { input: '15' }, modelRevision: 2 } });
    expect(current.items.find((r) => r.kind === 'valuation')).toMatchObject({ amountDecimal: '0.00003', availability: 'priced' });
    expect(await f.summary(resumed, 'resumed', 'resume-3')).toMatchObject({ correctedBaselineSteps: 1, revisedBaselineSteps: 0 });
    await f.send(orderedResume({ ...step('S', '20'), actualModel: null }, 5), resumed, 'new-unknown');
    expect(await f.summary(resumed, 'new-unknown', 'resume-5')).toMatchObject({ correctedBaselineSteps: 0, revisedBaselineSteps: 1 });
    expect((await f.store.snapshot(f.scope, { limit: 20 }, Date.parse(at), 0)).items.find((r) => r.kind === 'usage')).toMatchObject({ projection: { contribution: { input: '15' } } });
  });
});


describe.skipIf(!available)('RFC-034 correction model ownership', () => {
  for (const initiallyUnknown of [false, true]) test(`a late earlier conflicting model disables the old correction; initially unknown=${initiallyUnknown}`, async () => {
    const f = setup(), v = repairValuation(f); await v.prices.savePrice(v.actor, v.profile.id, v.price);
    await v.prices.savePrice(v.actor, v.profile.id, { ...v.price, expectedRevision: 1, requestKey: 'other-model-price', model: 'N', rates: { ...v.price.rates, input: '5' } });
    await v.pricing.accept({ identity: f.identity, profile: v.profile }, v.clock.now());
    const original = orderedOwner(initiallyUnknown ? { ...step('S'), actualModel: null } : step('S'));
    original[1]!.measurements[0]!.revision = 3;
    await f.send(original); const resumed = { ...f.identity, executionGeneration: 2 };
    await f.send(orderedResume(initiallyUnknown ? { ...step('S', '15'), actualModel: null } : step('S', '15'), 5), resumed, 'resumed');
    if (initiallyUnknown) await f.send([numberFrame(step('S'), { revision: 4 })]);
    await v.drain();
    expect((await f.store.snapshot(f.scope, { limit: 20 }, Date.parse(at), 0)).items.find((r) => r.kind === 'valuation')).toMatchObject({ amountDecimal: '0.00003' });
    await f.send([numberFrame({ ...step('S'), actualModel: { provider: 'p', model: 'N', condition: null } }, { revision: 1 })]);
    await v.drain(); const current = await f.store.snapshot(f.scope, { limit: 20 }, Date.parse(at), 0);
    expect(current.items.find((r) => r.kind === 'usage')).toMatchObject({ modelRef: jsonHash({ provider: 'p', model: 'N', condition: null }), projection: { modelRevision: 1, contribution: { input: '10' }, issues: ['identity-conflict'] } });
    expect(current.items.find((r) => r.kind === 'valuation')).toMatchObject({ amountDecimal: '0.00005', completeness: 'partial' });
    expect(await f.summary(resumed, 'resumed', 'resume-5')).toMatchObject({ revisedBaselineSteps: 1, correctedBaselineSteps: 0 });
    await f.send(orderedResume({ ...step('S', '12'), actualModel: { provider: 'p', model: 'N', condition: null } }, 3), resumed, 'older-new-model');
    expect(await f.summary(resumed, 'older-new-model', 'resume-3')).toMatchObject({ revisedBaselineSteps: 1, correctedBaselineSteps: 0 });
    expect((await f.store.snapshot(f.scope, { limit: 20 }, Date.parse(at), 0)).items.find((r) => r.kind === 'usage')).toMatchObject({ projection: { contribution: { input: '10' } } });
  });
});


describe.skipIf(!available)('RFC-034 correction scope ownership', () => {
  for (const change of ['path', 'turn'] as const) test(`a late earlier ${change} invalidates the prior correction scope`, async () => {
    const f = setup(), v = repairValuation(f); await v.prices.savePrice(v.actor, v.profile.id, v.price);
    await v.pricing.accept({ identity: f.identity, profile: v.profile }, v.clock.now());
    const child = { ...step('S'), sessionId: 'child', parentSessionId: 'root', ancestors: ['root'] };
    const original = orderedOwner(child); original[1]!.measurements[0]!.revision = 3;
    await f.send(original); const resumed = { ...f.identity, executionGeneration: 2 };
    await f.send(orderedResume({ ...child, usage: { ...child.usage, input: '15' } }, 5), resumed, 'resumed'); await v.drain();
    const older = numberFrame(change === 'path' ? { ...child, parentSessionId: 'X', ancestors: ['root', 'X'] } : child, { revision: 1 });
    if (change === 'turn') older.measurements[0]!.scope!.turn = 'different-turn';
    await f.send([older]); await v.drain();
    const current = await f.store.snapshot(f.scope, { limit: 20 }, Date.parse(at), 0);
    expect(current.items.find((r) => r.kind === 'usage')).toMatchObject({ projection: { contribution: { input: '10' }, issues: ['identity-conflict'] } });
    expect(current.items.find((r) => r.kind === 'valuation')).toMatchObject({ amountDecimal: '0.00002', completeness: 'partial' });
    expect(await f.summary(resumed, 'resumed', 'resume-5')).toMatchObject({ correctedBaselineSteps: 0, revisedBaselineSteps: 1 });
    expect(await f.summary()).toMatchObject({ historicalRevisionGap: true });
  });
});
