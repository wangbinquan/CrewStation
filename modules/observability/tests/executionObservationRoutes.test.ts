import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { DevelopmentUsageIdentitySchema, ExecutionObservationIdentitySchema, ExecutionObservationPageSchema, IDENTITY_HEADERS, type Actor, type UserId } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import { createFakeK8sClient } from '@crewstation/k8s';
import { fixedClock } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { createObservabilityModule, observabilityMigrations } from '../wiring';
import { drizzleCostVisibility } from '../adapters/persistence/drizzleTokenPricing';
import { drizzleUsageLedger } from '../adapters/persistence/drizzleUsageLedger';
import { executionObservationUseCases } from '../application/executionObservations';
import type { UsageEvidence } from '../domain/usageProjection';

const available = await testDatabaseAvailable();
let tdb: TestDatabase;
const actor: Actor = { userId: '01a0bf5d-8f4b-7793-867c-efd7527b386b' as UserId, isAdmin: true };
const clock = fixedClock('2026-09-28T00:00:00Z');
beforeAll(async () => { if (available) tdb = await createTestDatabase([observabilityMigrations]); });
afterAll(async () => { await tdb?.drop(); });
function fixture() {
  const identity = ExecutionObservationIdentitySchema.parse({ projectId: Bun.randomUUIDv7(), taskId: Bun.randomUUIDv7(), subtaskId: Bun.randomUUIDv7(), executionId: Bun.randomUUIDv7(), executionGeneration: 1 });
  const profileId = Bun.randomUUIDv7();
  const scope = { projectId: identity.projectId, taskId: identity.taskId };
  const module = createObservabilityModule({ db: tdb.db, k8s: createFakeK8sClient(), clock, isAdmin: async (id) => id === actor.userId,
    authorizer: { authorize: async () => undefined }, services: { resolveServiceOfProject: async () => undefined }, slots: { slotRoles: async () => undefined },
    pricingProfiles: { list: async () => [{ id: profileId, name: 'runtime', revision: 1, protocol: 'opencode', model: null }] },
    executionAccess: { task: async () => scope }, traces: { environments: { traceKeys: async () => [], activeTraceIds: async () => [], list: async () => [] },
      deliveries: { traceKeys: async () => [], activeTraceIds: async () => [], list: async () => [] }, businessTasks: { list: async () => [] }, sessions: { summarize: async () => [], events: async () => [] } },
  });
  const app = createApp({ name: 'execution-observations' });
  for (const route of module.http) app.route('/', route);
  const measurement: UsageEvidence = { kind: 'usage', identity, sourceId: 'runner', recordId: 'first', revision: 1,
    occurredAt: null, observedAt: clock.now().toISOString(), adapterVersion: 'fixture', modelRef: null, reporting: 'delta', inclusion: 'self',
    coverage: 'partial', validity: 'valid', scope: null, coveredThroughTurn: null, basis: { kind: 'invocation' },
    usage: { input: '100', output: null, cacheRead: '0', cacheWrite: null } };
  const seed = () => module.api.ingestExecutionUsage({ ...scope, sourceId: 'runner', expectedCursor: null, nextCursor: 'source:1', events: [
    { eventId: 'one', measurement }, { eventId: 'two', measurement: { ...measurement, recordId: 'second' } },
  ] });
  return { app, module, scope, seed, profileId, measurement, root: '/v3/business-tasks/' + identity.taskId + '/observations',
    costPath: '/v1/admin/observability/projects/' + identity.projectId + '/cost-visibility',
    service: { [IDENTITY_HEADERS.sourceService]: 'fixture/fixture' }, admin: { [IDENTITY_HEADERS.userId]: actor.userId, 'content-type': 'application/json' } };
}

describe.skipIf(!available)('RFC-034 execution observations HTTP and visibility versions', () => {
  test('bounded incremental pages expose native and projection revisions and a resumable committed cursor', async () => {
    const f = fixture(); await f.seed();
    const response = await f.app.request(f.root + '?limit=1', { headers: f.service });
    expect(response.status).toBe(200);
    const first = ExecutionObservationPageSchema.parse(await response.json());
    expect(first).toMatchObject({ mode: 'incremental', costVisibility: 'hidden', visibilityRevision: 0 });
    expect(first.items).toHaveLength(1); expect(first.nextCursor).not.toBeNull();
    expect(first.items[0]).toMatchObject({ revision: 1, projection: { projectionRevision: 1, contribution: { input: '100', output: null }, complete: false } });
    const tail = ExecutionObservationPageSchema.parse(await (await f.app.request(f.root + '?after=' + encodeURIComponent(first.nextCursor!) + '&limit=1', { headers: f.service })).json());
    expect(tail.items).toHaveLength(1); expect(tail.nextCursor).toBeNull();
    const empty = ExecutionObservationPageSchema.parse(await (await f.app.request(f.root + '?after=' + encodeURIComponent(tail.persistedThrough), { headers: f.service })).json());
    expect(empty).toMatchObject({ items: [], persistedThrough: tail.persistedThrough, costVisibility: 'hidden', visibilityRevision: 0 });
    expect((await f.app.request(f.root + '?after=invalid', { headers: f.service })).status).toBe(400);
    expect((await f.app.request(f.root + '?limit=501', { headers: f.service })).status).toBe(400);
  });
  test('a changed visibility version invalidates snapshot continuation and reaches empty incremental pages', async () => {
    const f = fixture(); await f.seed();
    const first = ExecutionObservationPageSchema.parse(await (await f.app.request(f.root + '?snapshot=true&limit=1', { headers: f.service })).json());
    expect(first.mode).toBe('snapshot'); if (first.mode !== 'snapshot') throw new Error('Expected snapshot');
    const saved = await f.app.request(f.costPath, { method: 'PUT', headers: f.admin, body: JSON.stringify({ expectedRevision: 0, requestKey: 'open-project-cost', visibility: 'project-members-and-services' }) });
    expect(saved.status).toBe(200); expect(await saved.json()).toMatchObject({ revision: 1, visibility: 'project-members-and-services' });
    const stale = await f.app.request(f.root + '?snapshot=true&snapshotId=' + first.snapshotId + '&cursor=' + first.nextCursor, { headers: f.service });
    expect(stale.status).toBe(409);
    const refreshed = ExecutionObservationPageSchema.parse(await (await f.app.request(f.root + '?snapshot=true', { headers: f.service })).json());
    expect(refreshed).toMatchObject({ mode: 'snapshot', visibilityRevision: 1, costVisibility: 'project-members-and-services' });
    expect(refreshed.items).toHaveLength(2);
    await f.app.request(f.costPath, { method: 'PUT', headers: f.admin, body: JSON.stringify({ expectedRevision: 1, requestKey: 'hide-project-cost', visibility: 'hidden' }) });
    const empty = await f.app.request(f.root + '?after=' + encodeURIComponent(first.snapshotThrough), { headers: f.service });
    expect(await empty.json()).toMatchObject({ items: [], visibilityRevision: 2, costVisibility: 'hidden' });
    expect(await (await f.app.request(f.costPath, { headers: f.admin })).json()).toMatchObject({ revision: 2, visibility: 'hidden' });
  });
  // RFC-034 review regression: invalid caller cursors must not become internal errors.
  test('invalid snapshot and ahead-of-head incremental cursors return a client error', async () => {
    const f = fixture(); await f.seed();
    const page = ExecutionObservationPageSchema.parse(await (await f.app.request(f.root + '?snapshot=true&limit=1', { headers: f.service })).json());
    if (page.mode !== 'snapshot') throw new Error('Expected snapshot');
    const responses = await Promise.all([
      f.app.request(f.root + '?snapshot=true&snapshotId=' + page.snapshotId + '&cursor=invalid', { headers: f.service }),
      f.app.request(f.root + '?after=' + encodeURIComponent(page.persistedThrough.replace(/:\d+$/, ':9999')), { headers: f.service }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([400, 400]);
    for (const response of responses) expect(await response.json()).toMatchObject({ error: 'validation' });
  });
  test('late CNY values appear when project visibility opens and snapshots retain the independent token projection', async () => {
    const f = fixture(), model = { provider: 'provider', model: 'actual-model', condition: null };
    await f.module.api.savePrice(actor, f.profileId, { expectedRevision: 0, requestKey: 'price-for-visible-cost', profileRevision: 1, protocol: 'opencode', ...model,
      currency: 'CNY', rates: { input: '1', output: '3', cacheRead: '0', cacheWrite: null }, effectiveFrom: clock.now().toISOString(), sourceNote: 'fixture' });
    await f.module.api.acceptExecutionPrice({ identity: f.measurement.identity, profile: { id: f.profileId, revision: 1, protocol: 'opencode' } });
    await f.seed();
    await f.module.api.valueExecutionUsage({ measurement: { identity: f.measurement.identity, sourceId: 'runner', recordId: 'first' }, usageRevision: 1, model, requestKey: 'late-valuation' });
    const read = async (query: string) => ExecutionObservationPageSchema.parse(await (await f.app.request(f.root + query, { headers: f.service })).json());
    const hidden = await read('');
    expect(hidden.items).toHaveLength(3);
    expect(hidden.items.find((item) => item.kind === 'valuation')).toMatchObject({ availability: 'not-authorized', amountDecimal: null, priceVersionRef: null, usageRevision: 1 });
    await f.module.api.setExecutionCostVisibility(actor, f.scope.projectId, { expectedRevision: 0, requestKey: 'show-valuation', visibility: 'project-members-and-services' });
    expect(await read('?after=' + encodeURIComponent(hidden.persistedThrough))).toMatchObject({ items: [], visibilityRevision: 1 });
    const visible = await read('?snapshot=true');
    expect(visible.items.filter((item) => item.kind === 'usage')).toHaveLength(2);
    expect(visible.items.find((item) => item.kind === 'valuation')).toMatchObject({ availability: 'priced', currency: 'CNY', amountDecimal: '0.0001', completeness: 'partial', valuationRevision: 1 });
    await f.module.api.setExecutionCostVisibility(actor, f.scope.projectId, { expectedRevision: 1, requestKey: 'hide-valuation', visibility: 'hidden' });
    const closed = await read('?snapshot=true');
    expect(closed.items.find((item) => item.kind === 'valuation')).toMatchObject({ availability: 'not-authorized', amountDecimal: null, priceVersionRef: null });
  });
  test('concurrent edits choose one revision and delayed request replay cannot overwrite newer visibility', async () => {
    const f = fixture(), store = drizzleCostVisibility(tdb.db);
    const input = { expectedRevision: 0, requestKey: 'open-cost-1', visibility: 'project-members-and-services' as const };
    const competing = { ...input, requestKey: 'open-cost-2' };
    const results = await Promise.allSettled([store.save(f.scope.projectId, input, clock.now()), store.save(f.scope.projectId, competing, clock.now())]);
    expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
    const winner = results[0]!.status === 'fulfilled' ? input : competing;
    await store.save(f.scope.projectId, { expectedRevision: 1, requestKey: 'hide-cost-1', visibility: 'hidden' }, clock.now());
    expect(await store.save(f.scope.projectId, winner, clock.now())).toMatchObject({ revision: 1 });
    expect(await store.read(f.scope.projectId)).toMatchObject({ visibility: 'hidden', revision: 2 });
    await expect(store.save(f.scope.projectId, { ...winner, visibility: 'hidden' }, clock.now())).rejects.toMatchObject({ kind: 'conflict' });
  });
  test('visibility changed while assembling a response requires a new read', async () => {
    const f = fixture(); await f.seed();
    const ledger = drizzleUsageLedger(tdb.db), visibility = drizzleCostVisibility(tdb.db);
    const api = executionObservationUseCases({ clock, visibility, access: { task: async () => f.scope }, authorizer: { authorize: async () => undefined },
      ledger: { ...ledger, snapshot: async (...args) => {
        const page = await ledger.snapshot(...args);
        await visibility.save(f.scope.projectId, { expectedRevision: 0, requestKey: 'during-snapshot', visibility: 'project-members-and-services' }, clock.now());
        return page;
      } },
    });
    await expect(api.executionObservations({ identity: 'fixture/fixture' }, f.scope.taskId, { snapshot: 'true', limit: 1 })).rejects.toMatchObject({ kind: 'conflict' });
  });
});

// Internal owner mistakes must fail at the reader; they cannot widen the service's public v1 page.
describe.skipIf(!available)('RFC-034 business observation ownership boundary', () => {
  test('incremental and frozen snapshot reads reject development documents in a business task scope', async () => {
    const f = fixture();
    const identity = DevelopmentUsageIdentitySchema.parse({ ...f.scope, sourceKind: 'development-agent', agentId: Bun.randomUUIDv7(), executionId: Bun.randomUUIDv7(), executionGeneration: 1 });
    await f.module.api.ingestExecutionUsage({ ...f.scope, sourceId: 'development', expectedCursor: null, nextCursor: 'first',
      events: [{ eventId: 'first', measurement: { ...f.measurement, sourceId: 'development', identity } }] });
    for (const query of [{ limit: 200 }, { snapshot: 'true' as const, limit: 200 }])
      await expect(f.module.api.executionObservations({ identity: 'fixture/fixture' }, f.scope.taskId, query)).rejects.toThrow();
  });
});
