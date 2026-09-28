import { afterEach, describe, expect, test } from 'bun:test';
import { ExecutionObservationIdentitySchema, ExecutionUsageObservationSchema, type ExecutionObservationIdentity, type RunnerBusinessReceipt, type RunnerUsageCapture, type RunnerUsageMeasurement, type RunnerUsageSourcePage, type TaskId, type Actor, type UserId } from '@crewstation/contracts';
import { fixedClock } from '@crewstation/kernel';
import { createFakeK8sClient } from '@crewstation/k8s';
import { createObservabilityModule, observabilityMigrations, type ObservabilityModule, type ObservabilityModuleDeps } from '@crewstation/module-observability';
import { createSessionModule, sessionMigrations } from '@crewstation/module-session';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { observationUsageSource } from '../application/observationPorts';

const available = await testDatabaseAvailable(), at = '2026-09-28T08:00:00.000Z';
const identity = () => ExecutionObservationIdentitySchema.parse({ projectId: Bun.randomUUIDv7(), taskId: Bun.randomUUIDv7(), subtaskId: Bun.randomUUIDv7(), executionId: Bun.randomUUIDv7(), executionGeneration: 1 });
const capture = (revision: number, baselineUnknown = false): RunnerUsageCapture => ({ version: 1, diagnostics: [], measurements: [{
  recordId: 'root', revision, occurredAt: null, observedAt: at, adapterVersion: 'test@1', actualModel: null,
  reporting: 'cumulative', inclusion: 'self', coverage: 'complete', validity: 'valid', scope: null, coveredThroughTurn: null,
  basis: baselineUnknown ? { kind: 'native-session', lineageKey: 'native', baseline: null } : { kind: 'invocation' },
  usage: { input: String(9007199254740992n + BigInt(revision)), cacheRead: '0', cacheWrite: '0', output: String(revision) },
}] });
async function seed(tdb: TestDatabase, owner: ExecutionObservationIdentity, count: number, baselineUnknown = false, actualModel: RunnerUsageMeasurement['actualModel'] = null) {
  const runtimeTaskId = Bun.randomUUIDv7() as TaskId, receipt: RunnerBusinessReceipt = { executionId: owner.executionId, attempt: 1, incarnation: crypto.randomUUID(), payloadDigest: 'a'.repeat(64),
    phase: 'running', lastSequence: count, acknowledgedSequence: count, outputBytes: 0, result: null };
  await tdb.db.execute(sql`INSERT INTO session.business_executions (task_id,execution_id,receipt,persisted_through) VALUES (${runtimeTaskId},${owner.executionId},${JSON.stringify(receipt)}::jsonb,${count})`);
  await tdb.db.execute(sql`INSERT INTO session.business_usage_sources (task_id,execution_id,attempt,incarnation,payload_digest) VALUES (${runtimeTaskId},${owner.executionId},1,${receipt.incarnation},${receipt.payloadDigest})`);
  for (let sequence = 1; sequence <= count; sequence++) await tdb.db.execute(sql`INSERT INTO session.business_usage_events (task_id,execution_id,sequence,agent_id,occurred_at,capture)
    VALUES (${runtimeTaskId},${owner.executionId},${sequence},${owner.executionId},${at},${JSON.stringify({ ...capture(sequence, baselineUnknown), measurements: capture(sequence, baselineUnknown).measurements.map((m) => ({ ...m, actualModel, ...(actualModel ? { usage: { input: '1000000', output: '3', cacheRead: '0', cacheWrite: '0' } } : {}) })) })}::jsonb)`);
  return { runtimeTaskId, ...receipt };
}
function session(tdb: TestDatabase) {
  return createSessionModule({ db: tdb.db, runnerAuth: { verifyRunnerToken: async () => ({ ok: false, reason: 'unused' }) },
    taskAccess: { canOpenStream: async () => false, onRunnerConnected: async () => true, onRunnerDisconnected: async () => {} }, isAdmin: async () => false,
    settings: { selfAddress: 'http://127.0.0.1', commandTimeoutMs: 10000, runnerStaleMs: 30000, replayLimit: 100 } });
}
function observation(tdb: TestDatabase, owner: ExecutionObservationIdentity, source: NonNullable<ObservabilityModuleDeps['usageSource']>, options: Partial<ObservabilityModuleDeps> = {}): ObservabilityModule {
  const empty = async () => [];
  return createObservabilityModule({ db: tdb.db, k8s: createFakeK8sClient(), clock: fixedClock(at), isAdmin: async () => false, usageSource: source,
    executionAccess: { task: async () => ({ projectId: owner.projectId, taskId: owner.taskId }) }, authorizer: { authorize: async () => undefined },
    services: { resolveServiceOfProject: async () => { throw new Error('unused'); } }, slots: { slotRoles: async () => ({ prod: 'blue', preview: 'green' }) },
    traces: { environments: { traceKeys: empty, activeTraceIds: empty, list: empty }, deliveries: { traceKeys: empty, activeTraceIds: empty, list: empty }, businessTasks: { list: empty }, sessions: { summarize: empty, events: empty } }, ...options,
  });
}
const read = (module: ObservabilityModule, taskId: TaskId) => module.api.executionObservations({ identity: 'fixture' }, taskId, { limit: 500 });

describe.skipIf(!available)('RFC-034 Session to observability durable projection', () => {
  let tdb: TestDatabase;
  afterEach(async () => { await tdb?.drop(); });
  test('ledger commit then lost ACK recovers after reopen without adding tokens or changes twice', async () => {
    tdb = await createTestDatabase([sessionMigrations, observabilityMigrations]); const owner = identity(); await seed(tdb, owner, 1);
    const journal = session(tdb); let lost = true;
    const source = observationUsageSource({ resolveUsageSource: async () => owner }, { ...journal.api,
      acknowledgeBusinessUsageSource: async (...args) => { if (lost) throw new Error('ACK lost'); await journal.api.acknowledgeBusinessUsageSource(...args); } });
    const first = observation(tdb, owner, source);
    await first.api.setExecutionCostVisibility({ userId: Bun.randomUUIDv7() as UserId, isAdmin: true }, owner.projectId, { expectedRevision: 0, requestKey: 'visible-costs', visibility: 'project-members-and-services' });
    expect(await first.api.reconcileExecutionUsage()).toBe(0);
    const before = await read(first, owner.taskId); expect(before.items).toHaveLength(2);
    expect(before.items.find((item) => item.kind === 'valuation')).toMatchObject({ currency: 'CNY', availability: 'unpriced', amountDecimal: null, usageRevision: 1 });
    expect(ExecutionUsageObservationSchema.parse(before.items[0]).projection.contribution.input).toBe('9007199254740993');
    expect(await journal.api.nextBusinessUsageSource()).toBeDefined();
    lost = false; const reopened = observation(tdb, owner, source); expect(await reopened.api.reconcileExecutionUsage()).toBe(1);
    expect((await read(reopened, owner.taskId)).items).toEqual(before.items); expect(await journal.api.nextBusinessUsageSource()).toBeUndefined();
  });
  test('multi-page replacement and unknown resumed baseline preserve projection meaning', async () => {
    tdb = await createTestDatabase([sessionMigrations, observabilityMigrations]); const owner = identity(); await seed(tdb, owner, 7, true);
    const journal = session(tdb), source = observationUsageSource({ resolveUsageSource: async () => owner }, journal.api), module = observation(tdb, owner, source);
    const work = module.api.reconcileExecutionUsage(); expect(module.api.reconcileExecutionUsage()).toBe(work); expect(await work).toBe(2);
    const page = await module.api.executionObservations({ identity: 'fixture' }, owner.taskId, { snapshot: 'true', limit: 100 });
    expect(page.items).toHaveLength(2); const current = ExecutionUsageObservationSchema.parse(page.items.find((item) => item.kind === 'usage'));
    expect(page.items.find((item) => item.kind === 'valuation')).toMatchObject({ currency: 'CNY', usageRevision: current.projection.projectionRevision, valuationRevision: 2 });
    expect(current.usage.input).toBe('9007199254740999'); expect(current.revision).toBe(7);
    expect(current.projection).toMatchObject({ contribution: { input: null, output: null }, complete: false, issues: ['baseline-unknown'] });
    expect(await journal.api.nextBusinessUsageSource()).toBeUndefined();
  });
  test('an unmapped source stays pending while a different task continues; mapping can recover later', async () => {
    tdb = await createTestDatabase([sessionMigrations, observabilityMigrations]); const blocked = identity(), healthy = identity();
    await seed(tdb, blocked, 1); await seed(tdb, healthy, 1); const journal = session(tdb); let mapped = false;
    const source = observationUsageSource({ resolveUsageSource: async (page) => page.executionId === healthy.executionId ? healthy : mapped ? blocked : undefined }, journal.api);
    const module = observation(tdb, healthy, source); expect(await module.api.reconcileExecutionUsage()).toBe(1);
    expect((await read(module, healthy.taskId)).items).toHaveLength(2); expect((await journal.api.nextBusinessUsageSource())?.executionId).toBe(blocked.executionId);
    mapped = true; const other = observation(tdb, blocked, source); expect(await other.api.reconcileExecutionUsage()).toBe(1);
    expect((await read(other, blocked.taskId)).items).toHaveLength(2); expect(await journal.api.nextBusinessUsageSource()).toBeUndefined();
  });
  test('a model-read failure retains tokens and retries CNY valuation against the accepted price head', async () => {
    tdb = await createTestDatabase([sessionMigrations, observabilityMigrations]); const owner = identity();
    const actual = { provider: 'native-provider', model: 'native-model', condition: null }; await seed(tdb, owner, 1, false, actual);
    const journal = session(tdb); let unavailable = true;
    const source = observationUsageSource({ resolveUsageSource: async () => owner }, { ...journal.api, readBusinessUsageMeasurement: async (...args) => {
      if (unavailable) throw new Error('numeric source unavailable'); return journal.api.readBusinessUsageMeasurement(...args);
    } });
    const profile = { id: Bun.randomUUIDv7(), revision: 1, protocol: 'opencode' as const, name: 'runtime', model: 'configured-default' };
    const module = observation(tdb, owner, source, { pricingProfiles: { list: async () => [profile] } });
    const actor: Actor = { userId: Bun.randomUUIDv7() as UserId, isAdmin: true };
    await module.api.setExecutionCostVisibility(actor, owner.projectId, { expectedRevision: 0, requestKey: 'visible-costs', visibility: 'project-members-and-services' });
    const price = { expectedRevision: 0, requestKey: 'price-one', profileRevision: 1, protocol: 'opencode' as const, ...actual,
      currency: 'CNY' as const, rates: { input: '1', output: '3', cacheRead: '0', cacheWrite: '0' }, effectiveFrom: at, sourceNote: 'CNY test' };
    const frozen = await module.api.savePrice(actor, profile.id, price); await module.api.acceptExecutionPrice({ identity: owner, profile: { id: profile.id, revision: profile.revision, protocol: profile.protocol } });
    await module.api.savePrice(actor, profile.id, { ...price, expectedRevision: 1, requestKey: 'price-later', effectiveFrom: '2026-09-28T09:00:00.000Z', rates: { ...price.rates, input: '999' } });
    expect(await module.api.reconcileExecutionUsage()).toBe(0);
    const usageOnly = await read(module, owner.taskId); expect(usageOnly.items).toHaveLength(1);
    expect(ExecutionUsageObservationSchema.parse(usageOnly.items[0]).projection.contribution.input).toBe('1000000');
    unavailable = false; expect(await module.api.reconcileExecutionUsage()).toBe(1);
    const valued = await read(module, owner.taskId); expect(valued.items).toHaveLength(2);
    expect(valued.items[0]).toEqual(usageOnly.items[0]);
    expect(valued.items[1]).toMatchObject({ kind: 'valuation', currency: 'CNY', availability: 'priced', amountDecimal: '1.000009', priceVersionRef: frozen.id, usageRevision: 1, valuationRevision: 1 });
    expect(await journal.api.nextBusinessUsageSource()).toBeUndefined();
  });

  test('late model evidence reprices one usage record and rejected metadata retains known CNY evidence', async () => {
    tdb = await createTestDatabase([sessionMigrations, observabilityMigrations]); const owner = identity(), native = await seed(tdb, owner, 1);
    const actual = { provider: 'native-provider', model: 'native-model', condition: null };
    const make = (revision: number, model: RunnerUsageMeasurement['actualModel'], input = '1000000') => ({ ...capture(revision), measurements: capture(revision).measurements.map((row) => ({ ...row, actualModel: model, usage: { input, output: '3', cacheRead: '0', cacheWrite: '0' } })) });
    await tdb.db.execute(sql`UPDATE session.business_usage_events SET capture=${JSON.stringify(make(1, null))}::jsonb WHERE execution_id=${owner.executionId}`);
    const journal = session(tdb), source = observationUsageSource({ resolveUsageSource: async () => owner }, journal.api);
    const profile = { id: Bun.randomUUIDv7(), revision: 1, protocol: 'opencode' as const, name: 'runtime', model: 'configured-default' };
    const module = observation(tdb, owner, source, { pricingProfiles: { list: async () => [profile] } });
    const actor: Actor = { userId: Bun.randomUUIDv7() as UserId, isAdmin: true };
    await module.api.setExecutionCostVisibility(actor, owner.projectId, { expectedRevision: 0, requestKey: 'visible-costs', visibility: 'project-members-and-services' });
    const price = await module.api.savePrice(actor, profile.id, { expectedRevision: 0, requestKey: 'price-native', profileRevision: 1, protocol: 'opencode', ...actual,
      currency: 'CNY', rates: { input: '1', output: '3', cacheRead: '0', cacheWrite: '0' }, effectiveFrom: at, sourceNote: 'CNY test' });
    await module.api.acceptExecutionPrice({ identity: owner, profile: { id: profile.id, revision: 1, protocol: profile.protocol } });
    expect(await module.api.reconcileExecutionUsage()).toBe(1);
    expect((await read(module, owner.taskId)).items.find((item) => item.kind === 'valuation')).toMatchObject({ availability: 'unpriced', amountDecimal: null });
    const append = async (sequence: number, model: RunnerUsageMeasurement['actualModel'], input: string) => {
      await tdb.db.execute(sql`INSERT INTO session.business_usage_events (task_id,execution_id,sequence,agent_id,occurred_at,capture)
        VALUES (${native.runtimeTaskId},${owner.executionId},${sequence},${owner.executionId},${at},${JSON.stringify(make(sequence, model, input))}::jsonb)`);
      await tdb.db.execute(sql`UPDATE session.business_executions SET persisted_through=${sequence} WHERE execution_id=${owner.executionId}`);
      expect(await module.api.reconcileExecutionUsage()).toBe(1);
      return module.api.executionObservations({ identity: 'fixture' }, owner.taskId, { snapshot: 'true', limit: 100 });
    };
    const recovered = await append(2, actual, '900000'); expect(recovered.items).toHaveLength(2);
    expect(recovered.items.find((item) => item.kind === 'usage')).toMatchObject({ revision: 1, projection: { observedRevision: 2, modelRevision: 2, contribution: { input: '1000000' }, complete: false, issues: ['unexplained-decrease'] } });
    expect(recovered.items.find((item) => item.kind === 'valuation')).toMatchObject({ currency: 'CNY', availability: 'priced', amountDecimal: '1.000009', priceVersionRef: price.id, usageRevision: 2 });
    const updated = await append(3, actual, '2000000');
    expect(updated.items.find((item) => item.kind === 'valuation')).toMatchObject({ amountDecimal: '2.000009', usageRevision: 3 });
    const conflict = await append(4, { ...actual, model: 'different-native-model' }, '9999999');
    expect(conflict.items).toHaveLength(2);
    expect(conflict.items.find((item) => item.kind === 'usage')).toMatchObject({ revision: 3, projection: { observedRevision: 4, contribution: { input: '2000000' }, issues: ['identity-conflict'] } });
    expect(conflict.items.find((item) => item.kind === 'valuation')).toMatchObject({ amountDecimal: '2.000009', completeness: 'partial', usageRevision: 4 });
    expect(await module.api.reconcileExecutionUsage()).toBe(0);
  });

  test('worker shutdown waits for in-flight source polling and restart creates one fresh loop', async () => {
    tdb = await createTestDatabase([observabilityMigrations]); const owner = identity();
    let release!: () => void, entered!: () => void, polls = 0;
    const gate = new Promise<void>((resolve) => { release = resolve; }), seen = new Promise<void>((resolve) => { entered = resolve; });
    const source = { measurement: async () => undefined, resolve: async () => owner, acknowledge: async () => {}, next: async (): Promise<RunnerUsageSourcePage | undefined> => { polls++; entered(); await gate; return undefined; } };
    const module = observation(tdb, owner, source), worker = module.workers[0]!; worker.start(); worker.start(); await seen;
    let stopped = false; const stop = worker.stop().then(() => { stopped = true; }); await Promise.resolve(); expect(stopped).toBe(false);
    release(); await stop; expect(polls).toBe(1); worker.start(); await worker.stop(); expect(polls).toBe(2);
  });
});
