// Real PG + Runner SQLite and explicit numeric ingestion, using synthetic owner environments.
// This does not exercise production dispatch, cleanup, a real model, identity or browser acceptance.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StartAgentCommandSchema, type Actor, type SaveTokenPrice } from '../../packages/contracts';
import { fixedClock, jsonHash, newResourceId } from '../../packages/kernel';
import { connectDatabase } from '../../packages/persistence';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '../../packages/testkit';
import { developmentUsageOwner } from '../../modules/dev-session/application/developmentUsage';
import { developmentUsageFixture } from '../../modules/dev-session/tests/developmentUsageFixture';
import { devSessionMigrations } from '../../modules/dev-session/wiring';
import { drizzleExecutionPricing, drizzleTokenPriceStore } from '../../modules/observability/adapters/persistence/drizzleTokenPricing';
import { drizzleExecutionValuations, drizzleUsageLedger } from '../../modules/observability/adapters/persistence/drizzleUsageLedger';
import { executionValuations } from '../../modules/observability/application/executionValuations';
import { tokenPricingUseCases } from '../../modules/observability/application/tokenPricing';
import { usageIngestion } from '../../modules/observability/application/usageIngestion';
import { observabilityMigrations } from '../../modules/observability/wiring';
import { developmentObservationAdmission } from '../../modules/platform/application/observationPorts';
import { DevelopmentUsageJournal } from '../../runtimes/task/src/agents/developmentUsageJournal';
import { developmentIntentDigest, validateDevelopmentStart } from '../../runtimes/task/src/agents/developmentStartIntent';

const available = await testDatabaseAvailable(), at = '2026-09-30T00:00:00.000Z';
let tdb: TestDatabase, connection: ReturnType<typeof connectDatabase>, directory: string, journal: DevelopmentUsageJournal;
beforeAll(async () => { if (available) { tdb = await createTestDatabase([devSessionMigrations, observabilityMigrations]); connection = connectDatabase(tdb.url, { max: 1 }); } });
afterEach(async () => { journal?.close(); journal = undefined!; if (directory) await rm(directory, { recursive: true, force: true }); directory = ''; });
afterAll(async () => { await connection?.close(); await tdb?.drop(); });
const model = { provider: 'actual-provider', model: 'actual-model', condition: null };
async function fixture() {
  const f = await developmentUsageFixture(connection.db), prices = drizzleExecutionPricing(connection.db);
  let now = '2026-09-30T01:00:00.000Z';
  const pricing = developmentObservationAdmission(() => ({ acceptExecutionPrice: (input) => prices.accept(input, new Date(now)) }));
  const owner = developmentUsageOwner(f.store, f.starts, f.environmentPort, pricing);
  const actor: Actor = { userId: f.start.createdBy, isAdmin: true };
  const profiles = [{ id: f.start.profile.profileId, revision: 2, name: 'Frozen development compute', protocol: 'opencode' as const, model: 'configured-model' }];
  const catalog = tokenPricingUseCases({ store: drizzleTokenPriceStore(connection.db), profiles: { list: async () => profiles }, clock: fixedClock(at) });
  const price: SaveTokenPrice = { expectedRevision: 0, requestKey: newResourceId(), profileRevision: 2, protocol: 'opencode', ...model,
    currency: 'CNY', rates: { input: '2', output: '5', cacheRead: '0', cacheWrite: '0' }, effectiveFrom: at, sourceNote: 'Synthetic development CNY terms' };
  return { ...f, owner, prices, catalog, actor, price, movePriceTime: () => { now = '2026-09-30T03:00:00.000Z'; } };
}

describe.skipIf(!available)('development owner admission across actual price store and Runner journal', () => {
  test('owner digest matches Runner normalization, transport secret rotation and restart recover the original receipt', async () => {
    const f = await fixture(), prepared = await f.owner.prepare(f.preparation);
    directory = await mkdtemp(join(tmpdir(), 'cs-development-owner-'));
    journal = new DevelopmentUsageJournal(directory, { projectId: f.workspace.projectId, workspaceTaskId: f.workspace.id, runtimeTaskId: f.child.id, podUid: f.info.podUid }, crypto.randomUUID());
    const bound = await f.owner.bind(f.child.id, journal.info()), admission = { intent: bound.intent, digestNonce: bound.digestNonce, key: bound.binding!.key };
    expect(prepared.payloadDigest).toBe(developmentIntentDigest(admission));
    const command = StartAgentCommandSchema.parse({ id: newResourceId(), type: 'startAgent', agentId: f.start.agentId,
      compute: f.start.compute, profileRevision: 2, launch: f.preparation.intent.launch, permission: f.start.permission, mode: 'interactive',
      initialPrompt: f.start.request.prompt, cwd: f.start.request.cwd, resumeSessionId: f.start.request.resumeSessionId,
      mcp: f.preparation.intent.mcp.map((m) => ({ ...m, headers: { Authorization: 'synthetic-token-first' } })),
      env: { SYNTHETIC_CREDENTIAL: 'synthetic-first' }, beforeStart: { profile: f.start.profile.profileId, revision: 2, contentHash: 'fixed-profile-content', steps: [], vars: {}, secrets: { TOKEN: 'synthetic-first' }, configFile: { kind: 'none' } }, processAttemptId: f.start.execution.runnerId, developmentUsage: admission });
    expect(validateDevelopmentStart(command, admission)).toEqual(admission);
    expect(validateDevelopmentStart({ ...command, id: newResourceId(), env: { SYNTHETIC_CREDENTIAL: 'synthetic-rotated' },
      mcp: command.mcp.map((m) => ({ ...m, headers: { Authorization: 'synthetic-token-rotated' } })), beforeStart: { ...command.beforeStart, secrets: { TOKEN: 'synthetic-rotated' } } }, admission)).toEqual(admission);
    expect(() => validateDevelopmentStart({ ...command, initialPrompt: 'changed' }, admission)).toThrow('固定的意图');
    expect(journal.reserve(admission).created).toBe(true); expect(journal.reserve(admission).created).toBe(false); journal.running(admission.key);
    journal.close(); journal = new DevelopmentUsageJournal(directory, { projectId: f.workspace.projectId, workspaceTaskId: f.workspace.id, runtimeTaskId: f.child.id, podUid: f.info.podUid }, crypto.randomUUID());
    const resumed = journal.info(admission.key); expect(resumed.receipt).toMatchObject({ key: admission.key, phase: 'unknown', interruption: 'runner-restarted' });
    expect(await f.owner.bind(f.child.id, resumed)).toEqual(bound);
    const source = await f.owner.resolve(admission.key); expect(source).toEqual({ registration: bound.binding!, price: prepared.price });
    for (const secret of ['owner-private-prompt', 'digestNonce', 'synthetic-first', 'synthetic-token']) expect(JSON.stringify(source)).not.toContain(secret);
  });

  test('original CNY catalog and acceptance survive restart and later configuration, including actual valuation', async () => {
    const f = await fixture(), first = await f.catalog.savePrice(f.actor, f.start.profile.profileId, f.price), prepared = await f.owner.prepare(f.preparation);
    expect(prepared.price).toMatchObject({ priceBookRevision: 1, acceptedAt: '2026-09-30T01:00:00.000Z' });
    await f.catalog.savePrice(f.actor, f.start.profile.profileId, { ...f.price, expectedRevision: 1, requestKey: newResourceId(), effectiveFrom: '2026-09-30T02:00:00.000Z', rates: { ...f.price.rates, input: '999' } }); f.movePriceTime();
    const recovered = developmentUsageOwner(f.store, f.starts, { getEnvironment: async () => { throw new Error('never borrow a current workspace'); } });
    expect(await recovered.prepare(f.preparation)).toEqual(prepared); expect(await f.prices.price(prepared.intent.identity, model)).toEqual(first);
    const sourceId = 'fixture-owner:' + f.child.id, identity = prepared.intent.identity, recordId = 'original-step';
    await usageIngestion(drizzleUsageLedger(connection.db))({ projectId: identity.projectId, taskId: identity.taskId, sourceId, expectedCursor: null, nextCursor: 'numeric:1', events: [{ eventId: 'numeric:1:0', measurement: {
      kind: 'usage', identity, sourceId, recordId, revision: 1, occurredAt: at, observedAt: at, modelRef: jsonHash(model), adapterVersion: 'fixture@1',
      reporting: 'delta', inclusion: 'self', coverage: 'complete', validity: 'valid', coveredThroughTurn: null, scope: null,
      usage: { input: '1000000', output: '5', cacheRead: '0', cacheWrite: '0' }, basis: { kind: 'invocation' },
    } }] });
    const value = await executionValuations({ store: drizzleExecutionValuations(connection.db), pricing: f.prices, clock: fixedClock(at) })({ measurement: { identity, sourceId, recordId }, usageRevision: 1, model, requestKey: newResourceId() });
    expect(value).toMatchObject({ identity, currency: 'CNY', priceVersionRef: first.id, amountDecimal: '2.000025', availability: 'priced', completeness: 'complete' });
  });

  test('an original empty catalog remains unpriced after prices are configured and the owner is recreated', async () => {
    const f = await fixture(), original = await f.owner.prepare(f.preparation); expect(original.price.priceBookRevision).toBe(0);
    await f.catalog.savePrice(f.actor, f.start.profile.profileId, f.price); f.movePriceTime();
    expect(await f.owner.prepare(f.preparation)).toEqual(original);
    expect(await f.prices.accept({ identity: original.intent.identity, profile: original.price.profile }, new Date('2026-09-30T03:00:00.000Z'))).toEqual(original.price);
    expect(await drizzleExecutionPricing(connection.db).price(original.intent.identity, model)).toBeUndefined();
  });
});
