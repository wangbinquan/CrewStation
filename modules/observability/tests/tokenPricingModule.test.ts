import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Actor, SaveTokenPrice, UserId } from '@crewstation/contracts';
import { IDENTITY_HEADERS } from '@crewstation/contracts';
import { fixedClock } from '@crewstation/kernel';
import { connectDatabase } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { tokenPricingUseCases } from '../application/tokenPricing';
import { drizzleTokenPriceStore } from '../adapters/persistence/drizzleTokenPricing';
import { createApp } from '@crewstation/http';
import { createFakeK8sClient } from '@crewstation/k8s';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { createObservabilityModule, observabilityMigrations } from '../wiring';
import type { ObservabilityModule } from '../wiring';

const available = await testDatabaseAvailable();
let tdb: TestDatabase, module: ObservabilityModule;
const actor: Actor = { userId: '01a0bf5d-8f4b-7793-867c-efd7527b386b' as UserId, isAdmin: true };
const profileId = '01a0bf5d-8f4b-7178-82e1-9a99060b1192';
const input: SaveTokenPrice = { expectedRevision: 0, requestKey: 'price-request-1', profileRevision: 1,
  protocol: 'opencode', provider: 'test', model: 'model-a', condition: null, currency: 'CNY',
  rates: { input: '0.000001', cacheRead: '0', cacheWrite: null, output: '1.2' },
  effectiveFrom: '2026-09-29T00:00:00.000Z', sourceNote: 'integration test' };
beforeAll(async () => {
  if (!available) return;
  tdb = await createTestDatabase([observabilityMigrations]);
  module = createObservabilityModule({
    db: tdb.db, k8s: createFakeK8sClient(), clock: fixedClock('2026-09-28T00:00:00Z'),
    isAdmin: async (id) => id === actor.userId,
    authorizer: { authorize: async () => undefined },
    services: { resolveServiceOfProject: async () => undefined }, slots: { slotRoles: async () => undefined },
    pricingProfiles: { list: async () => [{ id: profileId, name: 'test', revision: 1, protocol: 'opencode', model: 'model-a' }] },
    traces: { environments: { traceKeys: async () => [], activeTraceIds: async () => [], list: async () => [] },
      deliveries: { traceKeys: async () => [], activeTraceIds: async () => [], list: async () => [] },
      businessTasks: { list: async () => [] }, sessions: { summarize: async () => [], events: async () => [] } },
  });
});
afterAll(async () => { await tdb?.drop(); });
describe.skipIf(!available)('RFC-034 pricing storage and independent routes', () => {
  // A real base-pool directory lookup inside the transaction would wait forever
  // for its own only connection. Keep pricing usable with a one-connection pool.
  test('profile directory and immutable pricing share a one-connection database', async () => {
    const connection = connectDatabase(tdb.url, { max: 1 });
    const id = '01a0bf5d-8f4b-7178-82e1-9a99060b1193';
    const api = tokenPricingUseCases({
      store: drizzleTokenPriceStore(connection.db), clock: fixedClock('2026-09-28T00:00:00Z'),
      profiles: { list: async () => {
        await connection.db.execute(sql`select 1`);
        return [{ id, name: 'pooled', revision: 1, protocol: 'opencode', model: 'model-a' }];
      } },
    });
    const pending = api.savePrice(actor, id, { ...input, requestKey: 'single-pool-1' });
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      const saved = await Promise.race([pending, new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new Error('price save exhausted its connection pool')), 3000);
      })]);
      expect(saved).toMatchObject({ profileId: id, currency: 'CNY', revision: 1 });
    } finally {
      clearTimeout(deadline);
      await connection.close();
      await pending.catch(() => undefined);
    }
  }, 15_000);

  test('two stale concurrent edits commit one version, retry replays and failed edits roll back', async () => {
    expect((await module.api.pricingProfiles(actor)).items[0]?.pricingRevision).toBe(0);
    const results = await Promise.allSettled([
      module.api.savePrice(actor, profileId, input),
      module.api.savePrice(actor, profileId, { ...input, requestKey: 'price-request-2' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const history = await module.api.priceHistory(actor, profileId, { limit: 50 });
    expect(history.items).toHaveLength(1);
    expect(history.items[0]?.rates).toEqual(input.rates);
    const winning = results[0]?.status === 'fulfilled' ? input : { ...input, requestKey: 'price-request-2' };
    expect(await module.api.savePrice(actor, profileId, winning)).toEqual(history.items[0]!);
    await expect(module.api.savePrice(actor, profileId, { ...input, requestKey: 'invalid-date', expectedRevision: 1, effectiveFrom: '2026-09-27T00:00:00Z' })).rejects.toMatchObject({ kind: 'validation' });
    expect((await module.api.priceHistory(actor, profileId, { limit: 50 })).revision).toBe(1);
    const next = { ...input, requestKey: 'price-request-3', expectedRevision: 1, effectiveFrom: '2026-09-30T00:00:00.000Z' };
    await module.api.savePrice(actor, profileId, next);
    expect(await module.api.priceHistory(actor, profileId, { limit: 1 })).toMatchObject({ revision: 2, nextBeforeRevision: 2 });
    expect((await module.api.priceHistory(actor, profileId, { limit: 1, beforeRevision: 2 })).items[0]?.revision).toBe(1);
  });
  test('HTTP endpoints expose CNY price metadata with normal admin behavior', async () => {
    const app = createApp({ name: 'pricing-test' });
    for (const router of module.http) app.route('/', router);
    const root = '/v1/admin/observability/pricing/profiles';
    expect((await app.request(root)).status).toBe(401);
    const headers = { [IDENTITY_HEADERS.userId]: actor.userId, 'content-type': 'application/json' };
    expect((await app.request(root, { headers })).status).toBe(200);
    const history = await app.request(root + '/' + profileId + '/versions?limit=1', { headers });
    expect(history.status).toBe(200);
    expect((await history.json()).items[0].currency).toBe('CNY');
    expect((await app.request(root + '/' + profileId + '/versions?limit=1000', { headers })).status).toBe(400);
    expect((await app.request(root + '/' + profileId + '/versions', { method: 'POST', headers, body: JSON.stringify({ ...input, currency: 'USD' }) })).status).toBe(400);
    expect((await app.request(root, { headers: { ...headers, [IDENTITY_HEADERS.userId]: '01a0bf5d-8f4b-7793-867c-efd7527b386c' } })).status).toBe(403);
  });
});


describe.skipIf(!available)('RFC-034 execution acceptance price selection', () => {
  test('frozen profile/model/condition and acceptance time select immutable CNY terms', async () => {
    const store = drizzleTokenPriceStore(tdb.db);
    const id = '01a0bf5d-8f4b-7178-82e1-9a99060b1194';
    const profiles = [{ id, name: 'historical', revision: 1, protocol: 'opencode' as const, model: 'model-a' }];
    const api = tokenPricingUseCases({ store, profiles: { list: async () => profiles }, clock: fixedClock('2026-09-28T00:00:00Z') });
    const first = await api.savePrice(actor, id, { ...input, requestKey: 'acceptance-price-1' });
    const next = await api.savePrice(actor, id, { ...input, expectedRevision: 1, requestKey: 'acceptance-price-2', effectiveFrom: '2026-09-30T00:00:00Z', rates: { ...input.rates, input: '2' } });
    const identity = { profileId: id, profileRevision: 1, priceBookRevision: 1, protocol: 'opencode' as const, provider: 'test', model: 'model-a', condition: null, acceptedAt: '2026-09-29T00:00:00Z' };
    expect(await store.select(identity)).toEqual(first);
    expect(await store.select({ ...identity, acceptedAt: '2026-09-29T08:00:00+08:00' })).toEqual(first);
    // A later-published price cannot enter an already accepted catalogue.
    expect(await store.select({ ...identity, acceptedAt: '2026-09-30T00:00:00Z' })).toEqual(first);
    expect(await store.select({ ...identity, priceBookRevision: 2, acceptedAt: '2026-09-30T00:00:00Z' })).toEqual(next);
    expect(await store.select({ ...identity, priceBookRevision: 0 })).toBeUndefined();
    for (const priceBookRevision of [-1, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])
      await expect(store.select({ ...identity, priceBookRevision })).rejects.toThrow('Invalid accepted price catalogue revision');
    for (const patch of [{ profileRevision: 2 }, { provider: 'other' }, { model: 'other' }, { condition: 'batch' }, { acceptedAt: '2026-09-28T00:00:00Z' }]) expect(await store.select({ ...identity, ...patch })).toBeUndefined();
    profiles.splice(0);
    expect(await store.select(identity)).toEqual(first);
    await expect(store.select({ ...identity, acceptedAt: 'invalid' })).rejects.toThrow('Invalid execution acceptance timestamp');
  });
});
