import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { ExecutionObservationIdentitySchema, type Actor, type SaveTokenPrice, type UserId } from '@crewstation/contracts';
import { fixedClock } from '@crewstation/kernel';
import { connectDatabase } from '@crewstation/persistence';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { drizzleExecutionPricing, drizzleTokenPriceStore } from '../adapters/persistence/drizzleTokenPricing';
import { tokenPricingUseCases } from '../application/tokenPricing';
import { observabilityMigrations } from '../wiring';

const available = await testDatabaseAvailable();
let tdb: TestDatabase;
beforeAll(async () => { if (available) tdb = await createTestDatabase([observabilityMigrations]); });
afterAll(async () => { await tdb?.drop(); });
const actor: Actor = { userId: '01a0bf5d-8f4b-7793-867c-efd7527b386b' as UserId, isAdmin: true };
const at = (hour: number) => new Date(Date.UTC(2026, 8, 28, hour));
const identity = () => ExecutionObservationIdentitySchema.parse({ projectId: Bun.randomUUIDv7(), taskId: Bun.randomUUIDv7(), subtaskId: Bun.randomUUIDv7(), executionId: Bun.randomUUIDv7(), executionGeneration: 1 });
function fixture(db = tdb.db) {
  const id = Bun.randomUUIDv7(), store = drizzleExecutionPricing(db), profiles = [{ id, name: 'frozen-price', revision: 1, protocol: 'opencode' as const, model: 'configured-default' }];
  const api = tokenPricingUseCases({ store: drizzleTokenPriceStore(db), profiles: { list: async () => profiles }, clock: fixedClock(at(0).toISOString()) });
  const input = { identity: identity(), profile: { id, revision: 1, protocol: 'opencode' as const } };
  const price: SaveTokenPrice = { expectedRevision: 0, requestKey: 'price-first', profileRevision: 1, protocol: 'opencode', provider: 'provider', model: 'actual-model', condition: null,
    currency: 'CNY', rates: { input: '1', output: '3', cacheRead: '0', cacheWrite: null }, effectiveFrom: at(0).toISOString(), sourceNote: 'test CNY terms' };
  const model = { provider: 'provider', model: 'actual-model', condition: null };
  return { id, store, api, input, price, model, profiles };
}

describe.skipIf(!available)('RFC-034 immutable execution price acceptance', () => {
  test('an empty catalogue remains empty after prices are added and acceptance is retried', async () => {
    const f = fixture();
    const accepted = await f.store.accept(f.input, at(1));
    expect(accepted).toMatchObject({ acceptedAt: at(1).toISOString(), priceBookRevision: 0 });
    await f.api.savePrice(actor, f.id, f.price);
    const reopened = drizzleExecutionPricing(tdb.db);
    expect(await reopened.accept(f.input, at(4))).toEqual(accepted);
    expect(await reopened.get(f.input.identity)).toEqual(accepted);
    expect(await reopened.price(f.input.identity, f.model)).toBeUndefined();
    expect((await reopened.accept({ ...f.input, identity: identity() }, at(4))).priceBookRevision).toBe(1);
  });
  test('each execution keeps its original profile revision, acceptance time and CNY price after configuration changes', async () => {
    const f = fixture(), first = await f.api.savePrice(actor, f.id, f.price);
    const original = await f.store.accept(f.input, at(1));
    const second = await f.api.savePrice(actor, f.id, { ...f.price, expectedRevision: 1, requestKey: 'price-second', effectiveFrom: at(2).toISOString(), rates: { ...f.price.rates, input: '9' } });
    expect(await f.store.accept(f.input, at(3))).toEqual(original);
    expect(await f.store.price(f.input.identity, f.model)).toEqual(first);
    const next = { ...f.input, identity: identity() };
    expect(await f.store.accept(next, at(3))).toMatchObject({ priceBookRevision: 2 });
    expect(await f.store.price(next.identity, f.model)).toEqual(second);
    f.profiles.splice(0);
    expect(await drizzleExecutionPricing(tdb.db).price(f.input.identity, f.model)).toEqual(first);
    for (const actual of [null, { ...f.model, model: 'configured-default' }, { ...f.model, provider: 'other' }, { ...f.model, condition: 'batch' }])
      expect(await f.store.price(f.input.identity, actual)).toBeUndefined();
  });
  test('concurrent acceptance reuses one snapshot while conflicting identity or profile cannot replace it', async () => {
    const f = fixture(); await f.api.savePrice(actor, f.id, f.price);
    const accepted = await Promise.all([f.store.accept(f.input, at(1)), f.store.accept(f.input, at(2))]);
    expect(accepted[0]).toEqual(accepted[1]);
    for (const patch of [{ profile: { ...f.input.profile, revision: 2 } }, { profile: null }, { identity: { ...f.input.identity, taskId: identity().taskId } }])
      await expect(f.store.accept({ ...f.input, ...patch }, at(3))).rejects.toMatchObject({ kind: 'conflict' });
    expect(await f.store.get(f.input.identity)).toEqual(accepted[0]);
    expect(await f.store.get(identity())).toBeUndefined();
  });
  test('unknown and terminal profiles stay unpriced; invalid input never creates a snapshot', async () => {
    const f = fixture();
    await expect(f.store.accept(f.input, new Date('invalid'))).rejects.toMatchObject({ kind: 'validation' });
    await expect(f.store.accept({ ...f.input, profile: { ...f.input.profile, revision: 0 } }, at(1))).rejects.toMatchObject({ kind: 'validation' });
    expect(await f.store.get(f.input.identity)).toBeUndefined();
    for (const profile of [null, { ...f.input.profile, protocol: 'terminal' as const }]) {
      const input = { ...f.input, identity: identity(), profile };
      expect((await f.store.accept(input, at(1))).priceBookRevision).toBe(0);
      expect(await f.store.price(input.identity, f.model)).toBeUndefined();
    }
    expect(await f.store.price(identity(), f.model)).toBeUndefined();
  });
  test('the admission participant works with a one-connection database pool', async () => {
    const connection = connectDatabase(tdb.url, { max: 1 });
    try {
      const f = fixture(connection.db); await f.api.savePrice(actor, f.id, f.price);
      await f.store.accept(f.input, at(1));
      expect((await f.store.price(f.input.identity, f.model))?.currency).toBe('CNY');
    } finally { await connection.close(); }
  });
});
