// RFC-034: real development identities share ledger guarantees, not fabricated business subtasks.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { DevelopmentUsageIdentitySchema, ExecutionObservationIdentitySchema, UsageRecordSchema, type DevelopmentUsageIdentity, type NativeUsageProof, type NativeUsageStep, type RunnerUsageCapture, type Actor, type SaveTokenPrice } from '@crewstation/contracts';
import { fixedClock, jsonHash } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { drizzleExecutionPricing, drizzleTokenPriceStore } from '../adapters/persistence/drizzleTokenPricing';
import { drizzleExecutionValuations, drizzleUsageLedger } from '../adapters/persistence/drizzleUsageLedger';
import { nativeCaptures } from "../adapters/persistence/tables";
import { executionValuations } from '../application/executionValuations';
import { tokenPricingUseCases } from '../application/tokenPricing';
import { usageIngestion } from '../application/usageIngestion';
import { nativeCaptureId, nativeRecordId } from '../domain/usageProjection';
import type { UsageSourcePage } from '../ports/usageLedger';
import { observabilityMigrations } from '../wiring';

const available = await testDatabaseAvailable();
let tdb: TestDatabase;
beforeAll(async () => { if (available) tdb = await createTestDatabase([observabilityMigrations]); });
afterAll(async () => { await tdb?.drop(); });
const at = '2026-09-28T00:00:00.000Z', clock = fixedClock(at);
const model = { provider: 'actual-provider', model: 'actual-model', condition: null };
const counts = (input: string) => ({ input, output: '0', cacheRead: '0', cacheWrite: '0' });
const step = (id: string, input: string): NativeUsageStep => ({ id, sessionId: 'root', parentSessionId: null, ancestors: [], occurredAt: at, usage: counts(input), actualModel: model });
function identity(): DevelopmentUsageIdentity {
  return DevelopmentUsageIdentitySchema.parse({ sourceKind: 'development-agent', projectId: Bun.randomUUIDv7(), taskId: Bun.randomUUIDv7(), agentId: Bun.randomUUIDv7(), executionId: Bun.randomUUIDv7(), executionGeneration: 1 });
}
function proof(state: NativeUsageProof['state'], patch: Partial<NativeUsageProof> = {}): RunnerUsageCapture {
  return { version: 1, measurements: [], diagnostics: [], nativeProof: { contract: 'opencode-child-steps-v1', lineageKey: 'workspace-native', turn: 'first', turnIndex: 0, state,
    root: 'root', observedAt: at, baseline: { kind: 'fresh', fingerprint: null }, fingerprint: state === 'complete' ? 'final' : null,
    sessions: 1, steps: state === 'complete' ? 1 : 0, emitted: state === 'complete' ? 1 : 0, baselineSteps: 0, priorRevisionGap: false, issues: [], ...patch } };
}
function numeric(value: NativeUsageStep, turn = 'first', turnIndex = 0): RunnerUsageCapture {
  return { version: 1, diagnostics: [], measurements: [{ recordId: nativeRecordId(value), revision: 1, occurredAt: at, observedAt: at, actualModel: model,
    adapterVersion: 'native-test/1', reporting: 'delta', inclusion: 'self', coverage: 'complete', validity: 'valid', coveredThroughTurn: null,
    scope: { root: 'root', session: 'root', parentSession: null, ancestors: [], turn, turnIndex, level: 'request' }, usage: value.usage, basis: { kind: 'invocation' } }] };
}
function fixture() {
  const owner = identity(), ledger = drizzleUsageLedger(tdb.db), ingest = usageIngestion(ledger), pricing = drizzleExecutionPricing(tdb.db), values = drizzleExecutionValuations(tdb.db);
  const scope = { projectId: owner.projectId, taskId: owner.taskId }, value = executionValuations({ store: values, pricing, clock });
  let sequence = 0;
  const page = async (frames: RunnerUsageCapture[], who = owner): Promise<UsageSourcePage> => {
    const sourceId = 'runner:' + who.executionId, cursor = 'page:' + ++sequence;
    return { ...scope, sourceId, expectedCursor: await ledger.cursor(scope, sourceId), nextCursor: cursor,
      events: frames.flatMap((capture, index) => capture.measurements.map(({ actualModel, ...measurement }) => ({ eventId: `${cursor}:${index}:${measurement.recordId}`,
        measurement: { ...measurement, kind: 'usage' as const, identity: who, sourceId, modelRef: actualModel ? jsonHash(actualModel) : null } }))),
      native: frames.map((capture) => ({ identity: who, capture })) };
  };
  const send = async (frames: RunnerUsageCapture[], who = owner) => ingest(await page(frames, who));
  const summary = async (who = owner, turn = 'first') => (await tdb.db.select().from(nativeCaptures).where(eq(nativeCaptures.id, nativeCaptureId(who, 'runner:' + who.executionId, turn))).limit(1))[0]?.summary;
  const ref = (who: DevelopmentUsageIdentity, id: string) => ({ identity: who, sourceId: 'runner:' + who.executionId, recordId: nativeRecordId(step(id, '0')) });
  return { owner, scope, ledger, ingest, pricing, values, value, page, send, summary, ref };
}
async function prices(f: ReturnType<typeof fixture>) {
  const actor: Actor = { userId: Bun.randomUUIDv7() as Actor['userId'], isAdmin: true };
  const profiles = [{ id: Bun.randomUUIDv7(), revision: 7, protocol: 'opencode' as const },
    { id: Bun.randomUUIDv7(), revision: 8, protocol: 'opencode' as const }];
  const api = tokenPricingUseCases({ store: drizzleTokenPriceStore(tdb.db), profiles: { list: async () => profiles.map((profile) => ({ ...profile, name: profile.id, model: 'configured' })) }, clock });
  const price: SaveTokenPrice = { expectedRevision: 0, requestKey: 'first-price', profileRevision: 7, protocol: 'opencode', ...model, currency: 'CNY',
    rates: { input: '2', output: '0', cacheRead: '0', cacheWrite: '0' }, effectiveFrom: at, sourceNote: 'Development CNY fixture' };
  const original = await api.savePrice(actor, profiles[0]!.id, price);
  const other = await api.savePrice(actor, profiles[1]!.id, { ...price, profileRevision: 8, rates: { ...price.rates, input: '9' } });
  await f.pricing.accept({ identity: f.owner, profile: profiles[0]! }, clock.now());
  return { actor, profiles, api, price, original, other };
}

describe.skipIf(!available)('RFC-034 internal development ledger compatibility', () => {
  test('two development executions use independent frozen profiles; a historical repair keeps its original owner and CNY price', async () => {
    const f = fixture(), p = await prices(f), old = step('S', '10');
    await f.send([proof('pending'), numeric(old), proof('complete', { order: { epoch: 'native-db', sequence: 1 } })]);
    const originalValue = await f.value({ measurement: f.ref(f.owner, 'S'), usageRevision: 1, model, requestKey: 'original-value' });
    expect(originalValue).toMatchObject({ amountDecimal: '0.00002', priceVersionRef: p.original.id, identity: f.owner });
    const frozen = await f.ledger.snapshot(f.scope, { limit: 1 }, Date.parse(at), 0);
    expect(frozen.nextCursor).not.toBeNull();
    await p.api.savePrice(p.actor, p.profiles[0]!.id, { ...p.price, expectedRevision: 1, requestKey: 'later-price', effectiveFrom: '2026-09-28T01:00:00.000Z', rates: { ...p.price.rates, input: '999' } });
    const cli = DevelopmentUsageIdentitySchema.parse({ ...f.owner, sourceKind: 'development-cli', executionId: Bun.randomUUIDv7(), agentId: Bun.randomUUIDv7() });
    await f.pricing.accept({ identity: cli, profile: p.profiles[1]! }, new Date('2026-09-28T02:00:00.000Z'));
    const common = { turn: 'resume', turnIndex: 1, baseline: { kind: 'resume' as const, fingerprint: 'before', order: { epoch: 'native-db', sequence: 2 } }, baselineSteps: 1 };
    const input = await f.page([proof('pending', common), numeric(step('T', '3'), 'resume', 1), { version: 1, measurements: [], diagnostics: [], nativeBaseline: {
      lineageKey: 'workspace-native', turn: 'resume', root: 'root', offset: 0, steps: [{ before: old, after: step('S', '15'), afterObserved: true }],
    } }, proof('complete', { ...common, steps: 2, emitted: 1, order: { epoch: 'native-db', sequence: 3 } })], cli);
    await f.ingest(input);
    expect(await f.summary(cli, 'resume')).toMatchObject({ state: 'complete', identity: cli, correctedBaselineSteps: 1 });
    expect(await f.summary()).toMatchObject({ state: 'complete', identity: f.owner });
    const pending = await f.values.pendingNativeRepairs(f.scope, 10);
    expect(pending.map((row) => row.usage.identity)).toEqual([f.owner]);
    const corrected = await f.value({ measurement: f.ref(f.owner, 'S'), usageRevision: pending[0]!.usage.projection.projectionRevision, model, requestKey: 'original-repair' });
    const current = await f.value({ measurement: f.ref(cli, 'T'), usageRevision: 1, model, requestKey: 'cli-value' });
    expect(corrected).toMatchObject({ identity: f.owner, amountDecimal: '0.00003', priceVersionRef: p.original.id });
    expect(current).toMatchObject({ identity: cli, amountDecimal: '0.000027', priceVersionRef: p.other.id });
    const reopened = drizzleUsageLedger(tdb.db), snapshot = await reopened.snapshot(f.scope, { limit: 20 }, Date.parse(at) + 1, 0);
    const usage = snapshot.items.filter((row) => row.kind === 'usage');
    expect(usage.reduce((total, row) => total + BigInt(row.projection.contribution.input!), 0n)).toBe(18n);
    expect(usage.find((row) => row.identity.executionId === f.owner.executionId)).toMatchObject({ usage: { input: '10' }, projection: { contribution: { input: '15' } } });
    const tail = await reopened.snapshot(f.scope, { snapshotId: frozen.snapshotId, cursor: frozen.nextCursor!, limit: 20 }, Date.parse(at) + 1, 0);
    expect([...frozen.items, ...tail.items].find((row) => row.kind === 'usage')).toMatchObject({ projection: { contribution: { input: '10' } } });
    expect([...frozen.items, ...tail.items].find((row) => row.kind === 'valuation')).toEqual(originalValue);
    await usageIngestion(reopened)(input);
    expect((await reopened.changes(f.scope, 0, 100)).persistedThrough).toBe(snapshot.snapshotThrough);
    expect(await drizzleExecutionPricing(tdb.db).price(f.owner, model)).toEqual(p.original);
    expect(await f.values.pendingNativeRepairs(f.scope, 10)).toEqual([]);
  });
  test('the complete execution identity prevents a different owner or source kind from replacing frozen prices', async () => {
    const f = fixture(), p = await prices(f), input = { identity: f.owner, profile: p.profiles[0]! };
    const accepted = await f.pricing.get(f.owner);
    expect(await drizzleExecutionPricing(tdb.db).accept(input, new Date(Date.parse(at) + 3600000))).toEqual(accepted!);
    const business = ExecutionObservationIdentitySchema.parse({ ...f.scope, executionId: f.owner.executionId, executionGeneration: 1, subtaskId: Bun.randomUUIDv7() });
    for (const changed of [business, { ...f.owner, agentId: identity().agentId }, { ...f.owner, taskId: identity().taskId }, { ...f.owner, sourceKind: 'development-cli' as const }])
      await expect(f.pricing.accept({ ...input, identity: changed }, clock.now())).rejects.toMatchObject({ kind: 'conflict' });
    expect(await f.pricing.get(f.owner)).toEqual(accepted);
    expect(await f.pricing.price(f.owner, null)).toBeUndefined();
  });
  test('invalid development scopes roll back the source cursor and no missing counters become zero', async () => {
    const f = fixture(), capture = numeric(step('unknown', '10'));
    capture.measurements[0]!.usage.output = null; capture.measurements[0]!.coverage = 'partial';
    const input = await f.page([capture]);
    const invalid = structuredClone(input); invalid.events[0]!.measurement.scope!.ancestors = ['missing'];
    await expect(f.ingest(invalid)).rejects.toThrow();
    expect(await f.ledger.cursor(f.scope, input.sourceId)).toBeNull();
    await f.ingest(input);
    const row = UsageRecordSchema.parse((await f.ledger.changes(f.scope, 0, 20)).items[0]);
    expect(row.identity).toEqual(f.owner);
    expect(row.projection).toMatchObject({ contribution: { input: '10', output: null }, complete: false });
    const withoutAdmission = executionValuations({ store: f.values, pricing: f.pricing, clock });
    expect(await withoutAdmission({ measurement: f.ref(f.owner, 'unknown'), usageRevision: 1, model: null, requestKey: 'unknown-value' })).toMatchObject({ availability: 'unpriced', amountDecimal: null });
  });
});
