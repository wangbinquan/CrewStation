import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { ExecutionObservationIdentitySchema, type Actor, type SaveTokenPrice, type UserId } from '@crewstation/contracts';
import { fixedClock } from '@crewstation/kernel';
import { connectDatabase, type Database } from '@crewstation/persistence';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { drizzleExecutionPricing, drizzleTokenPriceStore } from '../adapters/persistence/drizzleTokenPricing';
import { drizzleExecutionValuations, drizzleUsageLedger } from '../adapters/persistence/drizzleUsageLedger';
import { executionValuations } from '../application/executionValuations';
import { tokenPricingUseCases } from '../application/tokenPricing';
import { usageIngestion } from '../application/usageIngestion';
import type { UsageEvidence } from '../domain/usageProjection';
import { observabilityMigrations } from '../wiring';

const available = await testDatabaseAvailable();
let tdb: TestDatabase;
beforeAll(async () => { if (available) tdb = await createTestDatabase([observabilityMigrations]); });
afterAll(async () => { await tdb?.drop(); });
const actor: Actor = { userId: '01a0bf5d-8f4b-7793-867c-efd7527b386b' as UserId, isAdmin: true };
const clock = fixedClock('2026-09-28T00:00:00.000Z');
function fixture(db: Database = tdb.db) {
  const identity = ExecutionObservationIdentitySchema.parse({ projectId: Bun.randomUUIDv7(), taskId: Bun.randomUUIDv7(), subtaskId: Bun.randomUUIDv7(), executionId: Bun.randomUUIDv7(), executionGeneration: 1 });
  const profile = { id: Bun.randomUUIDv7(), revision: 1, protocol: 'opencode' as const };
  const pricing = drizzleExecutionPricing(db), store = drizzleExecutionValuations(db), ledger = drizzleUsageLedger(db), ingest = usageIngestion(ledger);
  const prices = tokenPricingUseCases({ store: drizzleTokenPriceStore(db), profiles: { list: async () => [{ ...profile, name: 'runtime', model: 'default-model' }] }, clock });
  const value = executionValuations({ pricing, store, clock });
  const evidence: UsageEvidence = { kind: 'usage', identity, sourceId: 'runner', recordId: 'meter', revision: 1,
    occurredAt: null, observedAt: clock.now().toISOString(), adapterVersion: 'fixture', modelRef: 'public-model', reporting: 'cumulative',
    inclusion: 'self', coverage: 'complete', validity: 'valid', scope: null, coveredThroughTurn: null,
    usage: { input: '1000000', output: '3', cacheRead: '0', cacheWrite: '0' }, basis: { kind: 'invocation' } };
  const model = { provider: 'actual-provider', model: 'actual-model', condition: null };
  const request = { measurement: { identity, sourceId: evidence.sourceId, recordId: evidence.recordId }, usageRevision: 1, model, requestKey: 'valuation-first' };
  const price: SaveTokenPrice = { expectedRevision: 0, requestKey: 'price-first', profileRevision: 1, protocol: 'opencode', ...model, currency: 'CNY',
    rates: { input: '1', output: '3', cacheRead: '0', cacheWrite: null }, effectiveFrom: clock.now().toISOString(), sourceNote: 'CNY fixture' };
  const append = (revision: number, patch: Partial<UsageEvidence> = {}) => ingest({ projectId: identity.projectId, taskId: identity.taskId, sourceId: evidence.sourceId,
    expectedCursor: revision === 1 ? null : 'page:' + (revision - 1), nextCursor: 'page:' + revision,
    events: [{ eventId: 'event:' + revision, measurement: { ...evidence, revision, ...patch } }] });
  const seed = async () => { const version = await prices.savePrice(actor, profile.id, price); await pricing.accept({ identity, profile }, clock.now()); await append(1); return version; };
  return { db, identity, profile, pricing, store, ledger, prices, value, evidence, request, price, append, seed };
}

describe.skipIf(!available)('RFC-034 independent CNY valuation journal', () => {
  test('late valuation and repeated receipts never duplicate token usage or change its source cursor', async () => {
    const f = fixture(), price = await f.seed();
    const first = await f.value(f.request);
    expect(first).toMatchObject({ currency: 'CNY', availability: 'priced', priceVersionRef: price.id, amountDecimal: '1.000009', usageRevision: 1, valuationRevision: 1, completeness: 'complete' });
    const reopen = executionValuations({ store: drizzleExecutionValuations(f.db), pricing: drizzleExecutionPricing(f.db), clock });
    expect(await reopen(f.request)).toEqual(first);
    expect(await reopen({ ...f.request, requestKey: 'same-basis-another-command' })).toEqual(first);
    const changes = await f.ledger.changes(f.identity, 0, 20);
    expect(changes.items.map((item) => item.kind)).toEqual(['usage', 'valuation']);
    expect(changes.persistedThrough).toBe(2);
    expect(await f.ledger.cursor(f.identity, 'runner')).toBe('page:1');
    expect((await f.store.usage(f.request.measurement))?.projection.contribution.input).toBe('1000000');
    await expect(f.value({ ...f.request, model: null })).rejects.toMatchObject({ kind: 'conflict' });
  });
  test('new prices do not change accepted execution values; later usage produces a separate valuation revision', async () => {
    const f = fixture(); await f.seed(); const first = await f.value(f.request);
    await f.prices.savePrice(actor, f.profile.id, { ...f.price, expectedRevision: 1, requestKey: 'price-second', effectiveFrom: '2026-09-28T01:00:00.000Z', rates: { ...f.price.rates, input: '999' } });
    await f.append(2, { usage: { ...f.evidence.usage, input: '2000000' } });
    await expect(f.value({ ...f.request, requestKey: 'stale-revision' })).rejects.toMatchObject({ kind: 'conflict' });
    const second = await f.value({ ...f.request, usageRevision: 2, requestKey: 'valuation-second' });
    expect(second).toMatchObject({ amountDecimal: '2.000009', valuationRevision: 2, usageRevision: 2 });
    expect(second.valuationId).toBe(first.valuationId);
    expect(await f.value(f.request)).toEqual(first);
    expect((await f.ledger.changes(f.identity, 0, 20)).items.map((item) => item.kind)).toEqual(['usage', 'valuation', 'usage', 'valuation']);
  });
  test('missing acceptance, unknown actual model and missing rates remain unpriced or partial', async () => {
    const f = fixture(); await f.append(1);
    expect(await f.value(f.request)).toMatchObject({ availability: 'unpriced', amountDecimal: null, priceVersionRef: null });
    await f.prices.savePrice(actor, f.profile.id, f.price); await f.pricing.accept({ identity: f.identity, profile: f.profile }, clock.now());
    const unknown = await f.value({ ...f.request, model: { ...f.request.model, model: 'default-model' }, requestKey: 'unknown-model' });
    expect(unknown).toMatchObject({ availability: 'unpriced', amountDecimal: null, valuationRevision: 2 });
    await f.append(2, { usage: { ...f.evidence.usage, cacheWrite: '50' } });
    expect(await f.value({ ...f.request, usageRevision: 2, requestKey: 'partial-valuation' })).toMatchObject({ availability: 'priced', amountDecimal: '1.000009', completeness: 'partial' });
    const other = { ...f.request.measurement, identity: { ...f.identity, executionGeneration: 2 } };
    await expect(f.value({ ...f.request, measurement: other, requestKey: 'unknown-execution' })).rejects.toMatchObject({ kind: 'not_found' });
    await expect(f.value({ ...f.request, requestKey: '' })).rejects.toMatchObject({ kind: 'validation' });
  });
  test('frozen snapshot pages contain the original usage and valuation despite later replacement', async () => {
    const f = fixture(); await f.seed(); const original = await f.value(f.request);
    const start = await f.ledger.snapshot(f.identity, { limit: 1 }, 1000, 0);
    expect(start).toMatchObject({ snapshotThrough: 2 }); expect(start.nextCursor).not.toBeNull();
    await f.append(2, { usage: { ...f.evidence.usage, input: '2000000' } });
    await f.value({ ...f.request, usageRevision: 2, requestKey: 'second-snapshot-value' });
    const tail = await f.ledger.snapshot(f.identity, { snapshotId: start.snapshotId, cursor: start.nextCursor!, limit: 1 }, 2000, 0);
    const items = [...start.items, ...tail.items];
    expect(items.find((item) => item.kind === 'valuation')).toEqual(original);
    expect(items.find((item) => item.kind === 'usage')).toMatchObject({ projection: { projectionRevision: 1, contribution: { input: '1000000' } } });
    expect(tail.nextCursor).toBeNull();
    const refreshed = await f.ledger.snapshot(f.identity, { limit: 20 }, 2000, 0);
    expect(refreshed.items).toHaveLength(2);
    expect(refreshed.items.find((item) => item.kind === 'valuation')).toMatchObject({ valuationRevision: 2, usageRevision: 2 });
  });
  test('usage changing during price lookup prevents a stale valuation from entering the journal', async () => {
    const f = fixture(); await f.seed();
    const delayed = executionValuations({ store: f.store, clock, pricing: { ...f.pricing, price: async (identity, model) => {
      const price = await f.pricing.price(identity, model); await f.append(2); return price;
    } } });
    await expect(delayed(f.request)).rejects.toMatchObject({ kind: 'conflict' });
    expect((await f.ledger.changes(f.identity, 0, 20)).items.map((item) => item.kind)).toEqual(['usage', 'usage']);
    expect(await f.store.receipt(f.identity, f.request.requestKey)).toBeUndefined();
  });
  test('concurrent commands converge on one valuation and the pipeline works with a single connection', async () => {
    const db = connectDatabase(tdb.url, { max: 1 });
    try {
      const f = fixture(db.db); await f.seed();
      const values = await Promise.all([f.value(f.request), f.value({ ...f.request, requestKey: 'concurrent-key' }), f.value(f.request)]);
      expect(values[0]).toEqual(values[1]); expect(values[0]).toEqual(values[2]);
      expect((await f.ledger.changes(f.identity, 0, 20)).persistedThrough).toBe(2);
    } finally { await db.close(); }
  });
});
