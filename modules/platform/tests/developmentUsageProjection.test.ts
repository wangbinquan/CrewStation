// RFC-034: the real Session PG outbox feeds an explicitly supplied development consumer.
import { afterEach, describe, expect, test } from 'bun:test';
import { DevelopmentUsageRegistrationSchema, type DevelopmentRunnerUsageCapture, type DevelopmentUsageReceipt,
  type UsageRecord, type UsageValuation, type Actor } from '@crewstation/contracts';
import { fixedClock, jsonHash } from '@crewstation/kernel';
import { createFakeK8sClient } from '@crewstation/k8s';
import { createObservabilityModule, observabilityMigrations, type ObservabilityModuleDeps } from '@crewstation/module-observability';
import { createSessionModule, sessionMigrations } from '@crewstation/module-session';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { developmentObservationSource } from '../application/developmentObservationPorts';
import type { DevelopmentObservationOwner } from '../ports/developmentObservations';

const available = await testDatabaseAvailable(), at = '2026-09-30T00:00:00.000Z', clock = fixedClock(at);
const actual = { provider: 'actual-provider', model: 'M', condition: null };
const numeric = (revision: number, input = '10', model = actual): DevelopmentRunnerUsageCapture => ({ version: 1, diagnostics: [], measurements: [{
  recordId: 'reused-native-id', revision, occurredAt: at, observedAt: at, adapterVersion: 'actual/1', actualModel: model,
  reporting: 'cumulative', inclusion: 'self', coverage: 'complete', validity: 'valid', scope: null, coveredThroughTurn: null,
  basis: { kind: 'invocation' }, usage: { input, output: '0', cacheRead: '0', cacheWrite: '0' },
}] });
function session(tdb: TestDatabase) {
  return createSessionModule({ db: tdb.db, runnerAuth: { verifyRunnerToken: async () => ({ ok: false, reason: 'unused' }) },
    taskAccess: { canOpenStream: async () => false, onRunnerConnected: async () => true, onRunnerDisconnected: async () => {} }, isAdmin: async () => false,
    settings: { selfAddress: 'http://127.0.0.1', commandTimeoutMs: 10000, runnerStaleMs: 30000, replayLimit: 100 } });
}
function observation(tdb: TestDatabase, source: ObservabilityModuleDeps['developmentUsageSource'], profile: { id: string; revision: number; protocol: 'opencode' }, supplied = true) {
  const empty = async () => [];
  return createObservabilityModule({ db: tdb.db, clock, k8s: createFakeK8sClient(), isAdmin: async () => false,
    ...(supplied ? { developmentUsageSource: source } : {}), pricingProfiles: { list: async () => [{ ...profile, name: 'runtime', model: 'configured-irrelevant' }] },
    authorizer: { authorize: async () => undefined }, services: { resolveServiceOfProject: async () => { throw new Error('unused'); } },
    slots: { slotRoles: async () => ({ prod: 'blue', preview: 'green' }) },
    traces: { environments: { traceKeys: empty, activeTraceIds: empty, list: empty }, deliveries: { traceKeys: empty, activeTraceIds: empty, list: empty }, businessTasks: { list: empty }, sessions: { summarize: empty, events: empty } },
  });
}
async function fixture(tdb: TestDatabase, options: { lostAck?: () => boolean; supplied?: boolean } = {}) {
  const executionId = Bun.randomUUIDv7(), registration = DevelopmentUsageRegistrationSchema.parse({ runtimeTaskId: executionId,
    key: { executionId, journalId: crypto.randomUUID(), incarnation: crypto.randomUUID(), payloadDigest: 'a'.repeat(64) }, podUid: 'session-original-pod',
    identity: { sourceKind: 'development-agent', projectId: Bun.randomUUIDv7(), taskId: Bun.randomUUIDv7(), agentId: Bun.randomUUIDv7(), executionId, executionGeneration: 1 },
    profileId: Bun.randomUUIDv7(), profileRevision: 7 });
  const journal = session(tdb); await journal.api.registerDevelopmentUsage(registration);
  let resolved: NonNullable<Awaited<ReturnType<DevelopmentObservationOwner['resolve']>>> | undefined;
  const owner = { resolve: async (key: typeof registration.key) => jsonHash(key) === jsonHash(registration.key) ? resolved : undefined };
  const registrationReads: Array<{ taskId: string; key: typeof registration.key }> = [];
  const source = developmentObservationSource(owner, { ...journal.api, getDevelopmentUsage: async (...args) => {
    registrationReads.push({ taskId: args[0], key: args[1] }); return journal.api.getDevelopmentUsage(...args);
  }, acknowledgeDevelopmentUsageSource: async (...args) => {
    if (options.lostAck?.()) throw new Error('numeric ACK lost'); await journal.api.acknowledgeDevelopmentUsageSource(...args);
  } });
  const profile = { id: registration.profileId, revision: 7, protocol: 'opencode' as const }, module = observation(tdb, source, profile, options.supplied ?? true);
  const actor: Actor = { userId: Bun.randomUUIDv7() as Actor['userId'], isAdmin: true };
  const priceInput = { expectedRevision: 0, requestKey: 'original-price', profileRevision: 7, protocol: 'opencode' as const, ...actual,
    currency: 'CNY' as const, rates: { input: '2', output: '0', cacheRead: '0', cacheWrite: '0' }, effectiveFrom: at, sourceNote: 'Actual CNY evidence' };
  const version = await module.api.savePrice(actor, profile.id, priceInput);
  const accepted = await module.api.acceptExecutionPrice({ identity: registration.identity, profile });
  resolved = { registration: structuredClone(registration), price: accepted };
  let through = 0;
  const append = async (frames: DevelopmentRunnerUsageCapture[]) => {
    for (const capture of frames) {
      const event = { sequence: ++through, occurredAt: at, capture };
      await tdb.db.execute(sql`INSERT INTO session.development_usage_events (task_id,sequence,digest,event)
        VALUES (${registration.runtimeTaskId},${through},${jsonHash(event)},${JSON.stringify(event)}::jsonb)`);
    }
    const receipt: DevelopmentUsageReceipt = { key: registration.key, podUid: registration.podUid, identity: registration.identity,
      profileId: profile.id, profileRevision: profile.revision, phase: 'running', lastSequence: through, acknowledgedSequence: through,
      finalThrough: null, result: null, interruption: null };
    await tdb.db.execute(sql`UPDATE session.development_usage_streams SET receipt=${JSON.stringify(receipt)}::jsonb,persisted_through=${through},runner_acknowledged_through=${through} WHERE task_id=${registration.runtimeTaskId}`);
  };
  const read = async () => {
    const key = jsonHash({ projectId: registration.identity.projectId, taskId: registration.identity.taskId });
    const usage = await tdb.db.execute<{ document: UsageRecord }>(sql`SELECT document FROM observability.usage_projections WHERE task_key=${key}`);
    const valuations = await tdb.db.execute<{ document: UsageValuation }>(sql`SELECT document FROM observability.execution_valuations WHERE task_key=${key}`);
    const changes = await tdb.db.execute<{ sequence: number }>(sql`SELECT sequence FROM observability.usage_heads WHERE task_key=${key}`);
    return { usage: usage.map((x) => x.document), valuations: valuations.map((x) => x.document), through: Number(changes[0]?.sequence ?? 0) };
  };
  return { module, profile, journal, source, append, read, accepted, actor, priceInput, version, registration, registrationReads,
    resolved: () => resolved!, replace: (value: typeof resolved) => { resolved = value; }, reopen: () => observation(tdb, source, profile) };
}

describe.skipIf(!available)('RFC-034 development Session outbox consumer', () => {
  let tdb: TestDatabase;
  afterEach(async () => { await tdb?.drop(); });
  const database = async () => { tdb = await createTestDatabase([sessionMigrations, observabilityMigrations]); return tdb; };
  test('lost ACK and module reopen retain one numeric/model/valuation contribution and exact original key', async () => {
    let lost = true; const f = await fixture(await database(), { lostAck: () => lost }); await f.append([numeric(1)]);
    expect(await f.module.api.reconcileExecutionUsage()).toBe(0); const before = await f.read();
    expect(before.usage).toHaveLength(1); expect(before.valuations).toHaveLength(1);
    expect(before.valuations[0]).toMatchObject({ currency: 'CNY', amountDecimal: '0.00002', priceVersionRef: f.version.id });
    expect(await f.journal.api.nextDevelopmentUsageSource()).toMatchObject({ key: f.registration.key, after: 0, through: 1 });
    lost = false; expect(await f.reopen().api.reconcileExecutionUsage()).toBe(1);
    expect(await f.read()).toEqual(before); expect(await f.journal.api.nextDevelopmentUsageSource()).toBeUndefined();
    expect(f.registrationReads.every((r) => r.taskId === f.registration.runtimeTaskId && jsonHash(r.key) === jsonHash(f.registration.key))).toBe(true);
  });
  test('multiple fixed pages drain in one single flight; all ordinary model evidence survives ACK', async () => {
    const f = await fixture(await database()); await f.append(Array.from({ length: 7 }, (_, n) => numeric(n + 1, String(n + 1))));
    const work = f.module.api.reconcileExecutionUsage(); expect(f.module.api.reconcileExecutionUsage()).toBe(work); expect(await work).toBe(2);
    const rows = await f.read(); expect(rows.usage[0]).toMatchObject({ revision: 7, projection: { contribution: { input: '7' } } });
    expect(rows.valuations[0]).toMatchObject({ amountDecimal: '0.000014', priceVersionRef: f.version.id });
    const count = await tdb.db.execute<{ count: string }>(sql`SELECT count(*) FROM observability.development_model_evidence`);
    expect(Number(count[0]!.count)).toBe(7); expect(await f.journal.api.nextDevelopmentUsageSource()).toBeUndefined();
  });
  test('same key with different Session/owner Pod, identity, profile or original price never commits or ACKs', async () => {
    const f = await fixture(await database()); await f.append([numeric(1)]); const original = structuredClone(f.resolved());
    const replacements = [ { ...original, registration: { ...original.registration, podUid: 'owner-other-pod' } },
      { ...original, registration: { ...original.registration, identity: { ...original.registration.identity, agentId: Bun.randomUUIDv7() } } },
      { ...original, registration: { ...original.registration, profileRevision: 8 } },
      { ...original, price: { ...original.price, priceBookRevision: 0 } },
      { ...original, registration: { ...original.registration, key: { ...original.registration.key, incarnation: crypto.randomUUID() } } } ];
    for (const changed of replacements) {
      f.replace(changed); expect(await f.module.api.reconcileExecutionUsage()).toBe(0);
      expect(await f.read()).toEqual({ usage: [], valuations: [], through: 0 });
      expect(await f.journal.api.nextDevelopmentUsageSource()).toMatchObject({ after: 0, through: 1 });
    }
    f.replace(original); expect(await f.module.api.reconcileExecutionUsage()).toBe(1);
  });
  test('older ACKed model evidence prices retained 10 after conflicting N arrives and later prices never replace acceptance', async () => {
    const f = await fixture(await database()); await f.append([numeric(1)]); expect(await f.module.api.reconcileExecutionUsage()).toBe(1);
    await f.module.api.savePrice(f.actor, f.profile.id, { ...f.priceInput, expectedRevision: 1, requestKey: 'later-price', effectiveFrom: '2026-09-30T01:00:00.000Z', rates: { ...f.priceInput.rates, input: '999' } });
    await f.append([numeric(2, '999', { ...actual, model: 'N' })]);
    expect(await f.reopen().api.reconcileExecutionUsage()).toBe(1); const rows = await f.read();
    expect(rows.usage[0]).toMatchObject({ revision: 1, projection: { observedRevision: 2, modelRevision: 1, contribution: { input: '10' }, issues: ['identity-conflict'] } });
    expect(rows.valuations[0]).toMatchObject({ amountDecimal: '0.00002', priceVersionRef: f.version.id, completeness: 'partial' });
    expect(await f.journal.api.nextDevelopmentUsageSource()).toBeUndefined();
  });
  test('valuation database failure holds ACK after numeric commit, then retries original CNY without duplicate usage', async () => {
    const f = await fixture(await database()); await f.append([numeric(1)]);
    await tdb.db.execute(sql`CREATE FUNCTION observability.fail_fixture_valuation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'temporary valuation failure'; END $$`);
    await tdb.db.execute(sql`CREATE TRIGGER fixture_valuation_failure BEFORE INSERT ON observability.execution_valuations FOR EACH ROW EXECUTE FUNCTION observability.fail_fixture_valuation()`);
    expect(await f.module.api.reconcileExecutionUsage()).toBe(0); const before = await f.read();
    expect(before.usage).toHaveLength(1); expect(before.valuations).toEqual([]); expect(before.through).toBe(1);
    expect(await f.journal.api.nextDevelopmentUsageSource()).toMatchObject({ after: 0, through: 1 });
    await tdb.db.execute(sql`DROP TRIGGER fixture_valuation_failure ON observability.execution_valuations`);
    expect(await f.reopen().api.reconcileExecutionUsage()).toBe(1); const after = await f.read();
    expect(after.usage).toEqual(before.usage); expect(after.through).toBe(2);
    expect(after.valuations[0]).toMatchObject({ amountDecimal: '0.00002', priceVersionRef: f.version.id });
    expect(await f.journal.api.nextDevelopmentUsageSource()).toBeUndefined();
  });
  test('one mismatched owner does not starve a different Session source and a missing owner remains retryable', async () => {
    await database(); const blocked = await fixture(tdb), healthy = await fixture(tdb);
    blocked.replace(undefined); await blocked.append([numeric(1)]); await healthy.append([numeric(1)]);
    expect(await healthy.module.api.reconcileExecutionUsage()).toBe(1);
    expect((await healthy.read()).usage).toHaveLength(1); expect((await blocked.read()).usage).toEqual([]);
    expect(await blocked.journal.api.nextDevelopmentUsageSource()).toMatchObject({ key: blocked.registration.key });
    blocked.replace({ registration: blocked.registration, price: blocked.accepted });
    expect(await blocked.module.api.reconcileExecutionUsage()).toBe(1);
  });
  test('production-default module never activates the optional source or adds a development polling worker', async () => {
    const f = await fixture(await database(), { supplied: false }); await f.append([numeric(1)]);
    expect(f.module.workers).toHaveLength(1); expect(await f.module.api.reconcileExecutionUsage()).toBe(0);
    expect(await f.read()).toEqual({ usage: [], valuations: [], through: 0 });
    expect(await f.journal.api.nextDevelopmentUsageSource()).toMatchObject({ after: 0, through: 1 });
  });
});
