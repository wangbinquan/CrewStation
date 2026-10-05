// RFC-034 v3: real PG atomic pages, actual file partitions and durable selected-model CNY.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { DevelopmentUsageRegistrationSchema, TaskIdSchema, RunnerUsageCaptureSchema, type DevelopmentRunnerUsageCapture, type NativeUsageProof,
  type NativeUsageStep, type RunnerUsageMeasurement, type Actor, type SaveTokenPrice } from '@crewstation/contracts';
import { fixedClock, jsonHash } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { drizzleUsageLedger, drizzleExecutionValuations } from '../adapters/persistence/drizzleUsageLedger';
import { drizzleTokenPriceStore, drizzleExecutionPricing } from '../adapters/persistence/drizzleTokenPricing';
import { nativeCaptures, nativeSteps, nativeBaselines } from "../adapters/persistence/tables";
import { developmentModelEvidence } from "../adapters/persistence/tables";
import { developmentUsageIngestion, prepareDevelopmentUsagePage } from '../application/developmentUsage';
import { valueDevelopmentUsagePage } from '../application/developmentValuations';
import { executionValuations } from '../application/executionValuations';
import { tokenPricingUseCases } from '../application/tokenPricing';
import { developmentCaptureSourceId, developmentStreamId, developmentNativePrefix } from '../domain/developmentNative';
import { nativeCaptureId, nativeRecordId } from '../domain/usageProjection';
import { observabilityMigrations } from '../wiring';

const available = await testDatabaseAvailable(), at = '2026-09-30T00:00:00.000Z', clock = fixedClock(at);
let tdb: TestDatabase;
beforeAll(async () => { if (available) tdb = await createTestDatabase([observabilityMigrations]); });
afterAll(async () => { await tdb?.drop(); });
const model = { provider: 'actual', model: 'M', condition: null };
const counts = (input: string) => ({ input, output: '0', cacheRead: '0', cacheWrite: '0' });
const store = () => ({ state: 'observed' as const, sourceEpoch: crypto.randomUUID(), actualPathDigest: 'a'.repeat(64), fileIdentityDigest: 'b'.repeat(64) });
const step = (id: string, input: string): NativeUsageStep => ({ id, sessionId: 'root', parentSessionId: null, ancestors: [], occurredAt: at, actualModel: model, usage: counts(input) });
function numeric(recordId: string, input: string, turn: string | null = 'first', index = 0, revision = 1,
  actualModel: RunnerUsageMeasurement['actualModel'] = model): DevelopmentRunnerUsageCapture {
  return { version: 1, diagnostics: [], measurements: [{ recordId, revision, actualModel, occurredAt: at, observedAt: at,
    adapterVersion: 'actual-fixture/1', reporting: 'delta', inclusion: 'self', coverage: 'complete', validity: 'valid', usage: counts(input),
    basis: { kind: 'invocation' }, coveredThroughTurn: null,
    scope: turn === null ? null : { root: 'root', session: 'root', parentSession: null, ancestors: [], turn, turnIndex: index, level: 'request' } }] };
}
function native(state: NativeUsageProof['state'], turn = 'first', index = 0, options: { resume?: boolean; before?: ReturnType<typeof store>; after?: ReturnType<typeof store>; partial?: boolean; emitted?: number } = {}): DevelopmentRunnerUsageCapture {
  const begin = state === 'pending', before = options.before ?? { state: 'pending' as const }, after = options.after ?? store();
  const proof: NativeUsageProof = { contract: 'opencode-child-steps-v1', lineageKey: 'frozen-native', turn, turnIndex: index, state,
    observedAt: at, root: 'root', baseline: options.resume ? { kind: 'resume', fingerprint: 'before', order: { epoch: 'same-db-order', sequence: 2 } } : { kind: 'fresh', fingerprint: null },
    order: begin ? undefined : { epoch: 'same-db-order', sequence: options.resume ? 3 : 1 },
    fingerprint: begin ? null : 'final', sessions: 1, steps: begin ? 0 : (options.emitted ?? 1) + (options.resume ? 1 : 0),
    emitted: begin ? 0 : options.emitted ?? 1, baselineSteps: options.resume ? 1 : 0, priorRevisionGap: options.partial ?? false,
    issues: options.partial ? ['native-prior-revision-gap'] : [] };
  return { version: 1, diagnostics: [], measurements: [], nativeProof: proof,
    nativeSource: { version: 1, stage: begin ? 'begin' : 'finish', lineageKey: proof.lineageKey, turn, turnIndex: index,
      observedAt: at, plannedPathDigest: 'c'.repeat(64), scope: begin && before.state !== 'observed' ? 'unverified' : 'execution-local',
      beginStore: before, finalStore: begin ? null : after, continuity: begin ? 'unverified' : before.state === 'pending' ? 'new' : 'same', issues: [] } };
}
async function fixture(selected = true, workspace?: { projectId: string; taskId: string }, podUid = 'original-pod') {
  const executionId = Bun.randomUUIDv7(), registration = DevelopmentUsageRegistrationSchema.parse({ runtimeTaskId: executionId,
    key: { executionId, journalId: crypto.randomUUID(), incarnation: crypto.randomUUID(), payloadDigest: 'a'.repeat(64) }, podUid,
    identity: { sourceKind: 'development-agent', projectId: workspace?.projectId ?? Bun.randomUUIDv7(), taskId: workspace?.taskId ?? Bun.randomUUIDv7(), agentId: Bun.randomUUIDv7(), executionId, executionGeneration: 1 },
    profileId: Bun.randomUUIDv7(), profileRevision: 7 });
  const scope = { projectId: registration.identity.projectId, taskId: registration.identity.taskId }, ledger = drizzleUsageLedger(tdb.db);
  const pricing = drizzleExecutionPricing(tdb.db), values = drizzleExecutionValuations(tdb.db), ingest = developmentUsageIngestion(ledger);
  const price = await pricing.accept({ identity: registration.identity, profile: { id: registration.profileId, revision: 7, protocol: 'opencode' } }, clock.now());
  const owner = { registration, price, ...(selected ? { nativeSelection: { version: 1 as const, expectedNamespace: 'frozen-native' } } : {}) };
  const value = valueDevelopmentUsagePage({ models: ledger, store: values, value: executionValuations({ store: values, pricing, clock }) });
  let after = 0;
  const page = (frames: DevelopmentRunnerUsageCapture[], start = after) => prepareDevelopmentUsagePage({ key: registration.key, after: start, through: start + frames.length,
    events: frames.map((capture, index) => ({ sequence: start + index + 1, occurredAt: at, capture })) }, owner, registration, owner.price);
  const send = async (frames: DevelopmentRunnerUsageCapture[]) => { const input = page(frames); await ingest(input); after = input.source.through; return input; };
  const ref = (recordId: string, turn: string | null = 'first', index = 0) => ({ identity: registration.identity,
    sourceId: developmentCaptureSourceId(developmentStreamId(registration), turn, turn === null ? null : index), recordId });
  const summary = async (turn = 'first', index = 0) => (await tdb.db.select().from(nativeCaptures)
    .where(eq(nativeCaptures.id, nativeCaptureId(registration.identity, ref('', turn, index).sourceId, turn))).limit(1))[0];
  return { registration, scope, ledger, pricing, values, ingest, owner, value, page, send, ref, summary };
}
async function priceFixture(f: Awaited<ReturnType<typeof fixture>>) {
  const actor: Actor = { userId: Bun.randomUUIDv7() as Actor['userId'], isAdmin: true };
  const profile = { id: f.registration.profileId, revision: 7, protocol: 'opencode' as const, name: 'frozen profile', model: 'configured-irrelevant' };
  const api = tokenPricingUseCases({ store: drizzleTokenPriceStore(tdb.db), profiles: { list: async () => [profile] }, clock });
  const input: SaveTokenPrice = { expectedRevision: 0, requestKey: 'original-price', profileRevision: 7, protocol: 'opencode', ...model,
    currency: 'CNY', rates: { input: '2', output: '0', cacheRead: '0', cacheWrite: '0' }, effectiveFrom: at, sourceNote: 'Actual model CNY' };
  const original = await api.savePrice(actor, profile.id, input);
  // The fixture was admitted with an empty catalogue. Use a new identity/registration to freeze the populated head.
  const executionId = Bun.randomUUIDv7();
  f.registration.runtimeTaskId = TaskIdSchema.parse(executionId); f.registration.key.executionId = executionId; f.registration.identity.executionId = executionId;
  f.owner.price = await f.pricing.accept({ identity: f.registration.identity, profile: { id: profile.id, revision: profile.revision, protocol: profile.protocol } }, clock.now());
  return { actor, profile, api, input, original };
}

describe.skipIf(!available)('RFC-034 development consumer private PG ledger', () => {
  test('cross-page chosen old model survives rejected new metadata and frozen empty catalogue remains empty', async () => {
    for (const turn of ['first', null]) {
      const f = await fixture(false), first = await f.send([numeric('record', '10', turn)]); await f.value(first);
      const conflicting = await f.send([numeric('record', '99', turn, 0, 2, { ...model, model: 'N' })]); await f.value(conflicting);
      const current = await f.values.usage(f.ref('record', turn));
      expect(current).toMatchObject({ revision: 1, modelRef: jsonHash(model), projection: { observedRevision: 2, modelRevision: 1, contribution: counts('10'), issues: ['identity-conflict'] } });
      expect(await f.ledger.developmentModel(f.ref('record', turn), 1)).toMatchObject({ actualModel: model, turn });
      const snapshot = await f.ledger.snapshot(f.scope, { limit: 50 }, Date.parse(at), 0);
      expect(snapshot.items.find((x) => x.kind === 'valuation')).toMatchObject({ currency: 'CNY', availability: 'unpriced', amountDecimal: null, usageRevision: current!.projection.projectionRevision });
    }
  });
  test('two turns reuse a record/revision without deduping meters or borrowing models; late model refines its original turn', async () => {
    const f = await fixture(false), input = await f.send([numeric('record', '10', 'turn-a', 0, 1, null), numeric('record', '3', 'turn-b', 1, 1, { ...model, model: 'N' })]);
    await f.value(input); expect((await f.ledger.snapshot(f.scope, { limit: 20 }, Date.parse(at), 0)).items).toHaveLength(4);
    const late = await f.send([numeric('record', '10', 'turn-a', 0, 2)]); await f.value(late);
    expect(await f.values.usage(f.ref('record', 'turn-a', 0))).toMatchObject({ modelRef: jsonHash(model), projection: { modelRevision: 2, contribution: counts('10') } });
    expect(await f.values.usage(f.ref('record', 'turn-b', 1))).toMatchObject({ modelRef: jsonHash({ ...model, model: 'N' }), projection: { modelRevision: 1, contribution: counts('3') } });
  });
  test('a conflicting model revision rolls back every earlier number, model row and cursor in the same page', async () => {
    const f = await fixture(false), first = await f.send([numeric('old', '10')]), input = f.page([numeric('new', '3'), numeric('old', '10', 'first', 0, 1, { ...model, model: 'N' })]);
    await expect(f.ingest(input)).rejects.toMatchObject({ kind: 'conflict' });
    expect(await f.ledger.cursor(f.scope, input.sourceId)).toBe(first.nextCursor);
    expect(await f.values.usage(f.ref('new'))).toBeUndefined(); expect(await f.ledger.developmentModel(f.ref('new'), 1)).toBeUndefined();
    expect(await f.ledger.developmentModel(f.ref('old'), 1)).toMatchObject({ actualModel: model });
    expect(await f.ingest(first)).toMatchObject({ applied: 0, duplicate: 1 });
    const changed = f.page([numeric('old', '11')], 0);
    await expect(f.ingest(changed)).rejects.toMatchObject({ kind: 'conflict' });
  });
  test('actual source may finish later; bounded keys convert once and ordinary proof without begin stays partial', async () => {
    const f = await fixture(), actual = store(), frames = [native('pending', 'first', 0, { after: actual }), numeric(nativeRecordId(step('S', '10')), '10')];
    await f.send(frames); const before = await f.summary();
    const pendingKey = (await tdb.db.select().from(nativeSteps).where(eq(nativeSteps.captureId, before!.id)))[0]!.nativeKey;
    expect(pendingKey).toStartWith('development-pending:'); expect(before?.finalized).toBe(false);
    const finished = await f.send([native('complete', 'first', 0, { after: actual })]);
    const after = await f.summary(); expect(after?.document.development?.sourceVerified).toBe(true); expect(after?.summary.state).toBe('complete');
    const converted = (await tdb.db.select().from(nativeSteps).where(eq(nativeSteps.captureId, before!.id)))[0]!.nativeKey;
    expect(converted).toStartWith('development-store:'); expect(converted).not.toContain('development-pending:');
    const head = (await f.ledger.changes(f.scope, 0, 100)).persistedThrough; await f.ingest(finished);
    expect((await f.ledger.changes(f.scope, 0, 100)).persistedThrough).toBe(head);
    const missing = await fixture(); await missing.send([native('complete', 'first', 0, { after: actual })]);
    expect((await missing.summary())?.summary).toMatchObject({ state: 'partial', issues: ['native-evidence-incomplete', 'native-baseline-not-started'] });
  });
  test('partial source verifies actual history before 10→15 repair; copies do not pollute owners or original CNY', async () => {
    const f = await fixture(), p = await priceFixture(f), actual = store(), old = step('S', '10');
    const first = await f.send([native('pending', 'first', 0, { after: actual }), numeric(nativeRecordId(old), '10'), native('complete', 'first', 0, { after: actual })]);
    await f.value(first); const frozen = await f.ledger.snapshot(f.scope, { limit: 1 }, Date.parse(at), 0);
    await p.api.savePrice(p.actor, p.profile.id, { ...p.input, expectedRevision: 1, requestKey: 'later-price', effectiveFrom: '2026-09-30T01:00:00.000Z', rates: { ...p.input.rates, input: '999' } });
    const baseline: DevelopmentRunnerUsageCapture = { version: 1, diagnostics: [], measurements: [], nativeBaseline: { lineageKey: 'frozen-native', turn: 'resume', root: 'root', offset: 0,
      steps: [{ before: old, after: step('S', '15'), afterObserved: true }] } };
    await f.send([native('pending', 'resume', 1, { resume: true, before: actual, after: actual }), numeric(nativeRecordId(step('T', '3')), '3', 'resume', 1), baseline]);
    const final = await f.send([native('partial', 'resume', 1, { resume: true, before: actual, after: actual, partial: true })]); await f.value(final);
    expect((await f.summary('resume', 1))?.document.development?.sourceVerified).toBe(true);
    expect((await f.summary('resume', 1))?.summary).toMatchObject({ state: 'complete', correctedBaselineSteps: 1 });
    expect(await f.values.usage(f.ref(nativeRecordId(old)))).toMatchObject({ usage: counts('10'), projection: { contribution: counts('15') } });
    for (let n = 0; n < 4; n++) {
      const turn = 'copy-' + n, copied = { ...actual, actualPathDigest: String(n).repeat(64), fileIdentityDigest: 'f'.repeat(64) };
      await f.send([native('pending', turn, n + 2, { after: copied }), numeric(nativeRecordId(old), '1', turn, n + 2), native('complete', turn, n + 2, { after: copied })]);
    }
    expect(await f.values.usage(f.ref(nativeRecordId(old)))).toMatchObject({ projection: { contribution: counts('15') } });
    const current = await f.ledger.snapshot(f.scope, { limit: 50 }, Date.parse(at) + 1, 0);
    expect(current.items.find((x) => x.kind === 'valuation' && x.sourceId === f.ref(nativeRecordId(old)).sourceId)).toMatchObject({ amountDecimal: '0.00003', priceVersionRef: p.original.id });
    const tail = await f.ledger.snapshot(f.scope, { snapshotId: frozen.snapshotId, cursor: frozen.nextCursor!, limit: 50 }, Date.parse(at) + 1, 0);
    expect([...frozen.items, ...tail.items].find((x) => x.kind === 'usage')).toMatchObject({ projection: { contribution: counts('10') } });
    const resume = await f.summary('resume', 1), rows = await tdb.db.select().from(nativeBaselines).where(eq(nativeBaselines.captureId, resume!.id));
    expect(rows[0]?.nativeKey).toStartWith(developmentNativePrefix(resume!.id, resume!.document.development!));
  });
  test('missing private selected-model evidence retries rather than overwriting known valuation as null', async () => {
    const f = await fixture(false), p = await priceFixture(f), first = await f.send([numeric('old', '10', null)]); await f.value(first);
    const before = await f.ledger.snapshot(f.scope, { limit: 50 }, Date.parse(at), 0);
    await tdb.db.delete(developmentModelEvidence).where(eq(developmentModelEvidence.meterKey, jsonHash(f.ref('old', null))));
    const rejected = await f.send([numeric('old', '99', null, 0, 2, { ...model, model: 'N' })]);
    await expect(f.value(rejected)).rejects.toMatchObject({ kind: 'not_found' });
    const after = await f.ledger.snapshot(f.scope, { limit: 50 }, Date.parse(at) + 1, 0);
    expect(after.items.find((x) => x.kind === 'valuation')).toEqual(before.items.find((x) => x.kind === 'valuation'));
    expect(after.items.find((x) => x.kind === 'valuation')).toMatchObject({ amountDecimal: '0.00002', priceVersionRef: p.original.id });
  });
  test('10,000/10,001 distinct indexed steps preserve ordinary numbers/models/cursor; refinement consumes no new slot', async () => {
    const f = await fixture(), p = await priceFixture(f), actual = store(); await f.send([native('pending', 'first', 0, { after: actual }), native('complete', 'first', 0, { after: actual, emitted: 10000 })]);
    const capture = (await f.summary())!, prefix = developmentNativePrefix(capture.id, capture.document.development!);
    await tdb.db.execute(sql`INSERT INTO observability.native_steps (capture_id,record_id,task_key,native_key,root,revision,fingerprint)
      SELECT ${capture.id}, 'old-' || n, ${jsonHash(f.scope)}, ${prefix} || lpad(n::text,64,'0'), 'root', 1, 'old' FROM generate_series(1,9999) n`);
    const page = await f.send([numeric('boundary-10000', '2'), numeric('overflow-10001', '3')]); await f.value(page);
    const rows = await tdb.db.select({ count: sql<string>`count(*)` }).from(nativeSteps).where(eq(nativeSteps.captureId, capture.id));
    expect(Number(rows[0]!.count)).toBe(10000);
    expect(await f.values.usage(f.ref('boundary-10000'))).toMatchObject({ projection: { contribution: counts('2') } });
    expect(await f.values.usage(f.ref('overflow-10001'))).toMatchObject({ projection: { contribution: counts('3') } });
    expect(await f.ledger.developmentModel(f.ref('overflow-10001'), 1)).toMatchObject({ actualModel: model });
    expect(await f.ledger.cursor(f.scope, page.sourceId)).toBe(page.nextCursor);
    expect((await f.summary())?.document.development).toMatchObject({ sourceVerified: true, overflow: true });
    expect((await f.summary())?.summary).toMatchObject({ state: 'partial', issues: ['native-evidence-incomplete'] });
    const rejected = await f.send([numeric('overflow-10001', '99', 'first', 0, 2, { ...model, model: 'N' })]); await f.value(rejected);
    expect(await f.values.usage(f.ref('overflow-10001'))).toMatchObject({ modelRef: jsonHash(model), projection: { modelRevision: 1, contribution: counts('3') } });
    const snapshot = await f.ledger.snapshot(f.scope, { limit: 20 }, Date.parse(at), 0);
    expect(snapshot.items.find((x) => x.kind === 'valuation' && x.recordId === 'overflow-10001')).toMatchObject({ amountDecimal: '0.000006', priceVersionRef: p.original.id });
    const repeated = await f.send([numeric('boundary-10000', '2', 'first', 0, 2)]); await f.value(repeated);
    const count = await tdb.db.select({ count: sql<string>`count(*)` }).from(nativeSteps).where(eq(nativeSteps.captureId, capture.id));
    expect(Number(count[0]!.count)).toBe(10000);
  });

  test('a forged finish begin/plan rolls back earlier numbers in that fixed page', async () => {
    for (const fake of ['store', 'plan']) {
      const f = await fixture(), actual = store(), begin = await f.send([native('pending', 'first', 0, { after: actual })]);
      const finish = native('complete', 'first', 0, { after: actual });
      if (fake === 'store') { finish.nativeSource!.beginStore = actual; finish.nativeSource!.continuity = 'same'; }
      else finish.nativeSource!.plannedPathDigest = 'd'.repeat(64);
      const page = f.page([numeric('new-number', '3'), finish]);
      await expect(f.ingest(page)).rejects.toMatchObject({ kind: 'conflict' });
      expect(await f.ledger.cursor(f.scope, page.sourceId)).toBe(begin.nextCursor);
      expect(await f.values.usage(f.ref('new-number'))).toBeUndefined();
      expect(await f.ledger.developmentModel(f.ref('new-number'), 1)).toBeUndefined();
      expect((await f.summary())?.document.development?.finish).toBeNull();
    }
  });
  test('unsupported begin and finish persist by stage without weakening the shared business capture schema', async () => {
    const f = await fixture();
    const make = (stage: 'begin' | 'finish'): DevelopmentRunnerUsageCapture => ({ version: 1, diagnostics: [], measurements: [],
      nativeProof: { contract: 'opencode-child-steps-v1', lineageKey: 'frozen-native', turn: 'first', turnIndex: 0, state: 'unsupported', root: null,
        observedAt: stage === 'begin' ? at : '2026-09-30T01:00:00.000Z', baseline: { kind: 'fresh', fingerprint: null }, fingerprint: null,
        sessions: 0, steps: 0, emitted: 0, baselineSteps: 0, priorRevisionGap: false, issues: ['native-unsupported'] },
      nativeSource: { version: 1, stage, lineageKey: 'frozen-native', turn: 'first', turnIndex: 0,
        observedAt: stage === 'begin' ? at : '2026-09-30T01:00:00.000Z', plannedPathDigest: null, scope: 'unverified',
        beginStore: { state: 'unavailable' }, finalStore: stage === 'begin' ? null : { state: 'unavailable' }, continuity: 'unverified', issues: ['native-source-unsupported'] } });
    expect(() => RunnerUsageCaptureSchema.parse(make('begin'))).toThrow();
    const page = await f.send([make('begin'), numeric('known-number', '3', 'first', 0, 1, null), make('finish')]); await f.value(page);
    const capture = await f.summary(); expect(capture?.summary.state).toBe('unsupported');
    expect(capture?.document.development).toMatchObject({ sourceVerified: false, begin: { stage: 'begin' }, finish: { stage: 'finish' } });
    expect(await f.values.usage(f.ref('known-number'))).toMatchObject({ projection: { contribution: counts('3') } });
  });
  test('another original Pod reporting the same store does not repair workspace history across Pods', async () => {
    const first = await fixture(), actual = store(), old = step('S', '10');
    await first.send([native('pending', 'first', 0, { after: actual }), numeric(nativeRecordId(old), '10'), native('complete', 'first', 0, { after: actual })]);
    const other = await fixture(true, first.scope, 'other-original-pod');
    const baseline: DevelopmentRunnerUsageCapture = { version: 1, diagnostics: [], measurements: [], nativeBaseline: { lineageKey: 'frozen-native', turn: 'resume', root: 'root', offset: 0,
      steps: [{ before: old, after: step('S', '15'), afterObserved: true }] } };
    await other.send([native('pending', 'resume', 1, { resume: true, before: actual, after: actual }), baseline,
      native('partial', 'resume', 1, { resume: true, before: actual, after: actual, partial: true, emitted: 0 })]);
    expect(await first.values.usage(first.ref(nativeRecordId(old)))).toMatchObject({ projection: { contribution: counts('10') } });
    expect((await other.summary('resume', 1))?.summary).toMatchObject({ state: 'partial', unresolvedBaselineSteps: 1, correctedBaselineSteps: 0 });
    expect(await other.values.pendingNativeRepairs(first.scope, 10)).toEqual([]);
  });

  test('finish-first empty tree followed by different begin root remains partial and isolated', async () => {
    const f = await fixture(), actual = store(), finish = native('complete', 'first', 0, { after: actual, emitted: 0 });
    finish.nativeProof!.root = 'B'; await f.send([finish]);
    const begin = native('pending', 'first', 0, { after: actual }); begin.nativeProof!.root = 'A'; await f.send([begin]);
    const capture = await f.summary(); expect(capture?.summary.state).toBe('partial');
    expect(capture?.summary.issues).toContain('native-root-changed'); expect(capture?.finalized).toBe(false);
    expect(capture?.document.development?.sourceVerified).toBe(true);
  });
  test('a late mismatched begin root cannot repair or degrade the original B owner', async () => {
    const f = await fixture(), actual = store(), old = step('S', '10');
    await f.send([native('pending', 'first', 0, { after: actual }), numeric(nativeRecordId(old), '10'), native('complete', 'first', 0, { after: actual })]);
    const baseline: DevelopmentRunnerUsageCapture = { version: 1, diagnostics: [], measurements: [], nativeBaseline: { lineageKey: 'frozen-native', turn: 'resume', root: 'root', offset: 0,
      steps: [{ before: old, after: step('S', '15'), afterObserved: true }] } };
    await f.send([native('complete', 'resume', 1, { resume: true, before: actual, after: actual, emitted: 0 }), baseline]);
    const begin = native('pending', 'resume', 1, { resume: true, before: actual, after: actual }); begin.nativeProof!.root = 'other-root';
    const page = await f.send([begin]); await f.value(page);
    expect(await f.values.usage(f.ref(nativeRecordId(old)))).toMatchObject({ projection: { contribution: counts('10') } });
    expect((await f.summary())?.summary).toMatchObject({ state: 'complete', historicalRevisionGap: false });
    const capture = (await f.summary('resume', 1))!;
    expect(capture.finalized).toBe(false); expect(capture.summary.issues).toContain('native-root-changed');
    expect(capture.summary.correctedBaselineSteps).toBe(0);
    const rows = await tdb.db.select().from(nativeBaselines).where(eq(nativeBaselines.captureId, capture.id));
    expect(rows[0]!.nativeKey).toStartWith('development-pending:');
  });
});

// The new journal is intentionally not selected by a v1 platform consumer.
// Preserve the original numeric ledger and cursor until the actual v2 projection is assembled.
test.skipIf(!available)('an explicit v2 admission cannot be acknowledged or projected by the legacy platform', async () => {
  const f = await fixture(), frame = numeric('original-held-number', '11'), raw = {
    key: f.registration.key, after: 0, through: 1, events: [{ sequence: 1, occurredAt: at, capture: frame }],
  };
  const before = await f.ledger.snapshot(f.scope, { limit: 20 }, Date.parse(at), 0);
  expect(() => prepareDevelopmentUsagePage(raw, { ...f.owner,
    nativeSelection: { version: 2, expectedNamespace: 'frozen-native' } }, f.registration, f.owner.price))
    .toThrow('原生 v2 尚未装配平台投影，不能确认或丢弃原数字页');
  const { snapshotId: beforeId, ...beforeLedger } = before;
  const { snapshotId: afterId, ...afterLedger } = await f.ledger.snapshot(f.scope, { limit: 20 }, Date.parse(at), 0);
  expect(afterId).not.toBe(beforeId); expect(afterLedger).toEqual(beforeLedger);
});
