// Acceptance-only controlled values: real WAL/journal/Session PG/ledger, no model invocation or supplier bill.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '../../../packages/testkit';
import type { DevelopmentRunnerUsageCapture, NativeUsageProof, UsageObservation } from '../../../packages/contracts';
import { jsonHash, systemClock } from '../../../packages/kernel';
import type { UsageTaskScope } from '../../../modules/observability/ports/usageLedger';
import { readNativeLegacyOwners } from '../../../modules/observability/adapters/persistence/developmentUsage/nativeLegacyOwners';
import { prepareNativeOriginalPage, originalNativeStep } from '../../../modules/observability/domain/developmentUsage/nativeOriginalPage';
import { connectDatabase } from '../../../packages/persistence';
import { sessionMigrations } from '../../../modules/session/wiring';
import { observabilityMigrations } from '../../../modules/observability/wiring';
import { drizzleUsageLedger, drizzleExecutionValuations } from '../../../modules/observability/adapters/persistence/drizzleUsageLedger';
import { drizzleExecutionPricing } from '../../../modules/observability/adapters/persistence/drizzleTokenPricing';
import { developmentUsageIngestion, prepareDevelopmentUsagePage } from '../../../modules/observability/application/developmentUsage';
import { prepareDevelopmentSourcePage } from '../../../modules/observability/application/developmentUsage/source';
import { valueDevelopmentUsagePage } from '../../../modules/observability/application/developmentValuations';
import { executionValuations } from '../../../modules/observability/application/executionValuations';
import { nativeRecordId } from '../../../modules/observability/domain/usageProjection';
import { nativeNumericFixture, numericModel } from './nativeNumericFixture';
import { nativeNumericPrice, nativeNumericWorker } from './nativeNumericPrice';

const available = await testDatabaseAvailable(); let database: TestDatabase;
beforeAll(async () => { if (available) database = await createTestDatabase([sessionMigrations, observabilityMigrations]); });
afterAll(async () => { await database?.drop(); });
const buckets = (input: string, cacheRead: string, output: string) => ({ input, cacheRead, cacheWrite: '0', output });
type Fixture = Awaited<ReturnType<typeof nativeNumericFixture>>;
type Execution = Awaited<ReturnType<Fixture['execution']>>;
function capture(f: Fixture, id: string, usage: ReturnType<typeof buckets>, revision: number, at: string, session = f.root): DevelopmentRunnerUsageCapture {
  const ancestors = session === f.root ? [] : [f.root];
  return { version: 1, diagnostics: [], measurements: [{
    recordId: nativeRecordId({ id, sessionId: session, parentSessionId: ancestors.length ? f.root : null,
      ancestors, occurredAt: at, actualModel: numericModel, usage }),
    revision, actualModel: numericModel, occurredAt: at, observedAt: at,
    adapterVersion: 'controlled-legacy-version-recovery/1', reporting: 'delta', inclusion: 'self',
    coverage: 'complete', validity: 'valid', basis: { kind: 'invocation' }, coveredThroughTurn: null, usage,
    scope: { root: f.root, session, parentSession: ancestors.length ? f.root : null,
      ancestors, turn: 'original-legacy-turn', turnIndex: 0, level: 'request' },
  }] };
}
function proof(f: Fixture, state: 'pending' | 'complete', emitted: number, sessions: number, at: string): DevelopmentRunnerUsageCapture {
  const nativeProof: NativeUsageProof = { contract: 'opencode-child-steps-v1', lineageKey: 'acceptance-native-lineage',
    turn: 'original-legacy-turn', turnIndex: 0, state, observedAt: at, root: f.root,
    baseline: { kind: 'fresh', fingerprint: null },
    ...(state === 'complete' ? { order: { epoch: 'controlled-original-order', sequence: 1 } } : {}),
    fingerprint: state === 'pending' ? null : 'controlled-original-final', sessions, steps: state === 'pending' ? 0 : emitted,
    emitted: state === 'pending' ? 0 : emitted, baselineSteps: 0, priorRevisionGap: false, issues: [] };
  return { version: 1, diagnostics: [], measurements: [], nativeProof };
}
function populate(f: Fixture, rows: readonly { id: string; session?: string; usage: ReturnType<typeof buckets> }[]) {
  const sessions = new Set([f.root, ...rows.map(row => row.session ?? f.root)]);
  f.db.transaction(() => {
    for (const id of sessions) f.db.query('INSERT INTO session VALUES(?,?,?)').run(id, id === f.root ? null : f.root, Date.now());
    for (const row of rows) {
      f.addStep(row.id, Number(row.usage.input), row.session ?? f.root);
      f.db.query('UPDATE part SET data=? WHERE id=?').run(JSON.stringify({ type: 'step-finish',
        tokens: { input: Number(row.usage.input), output: Number(row.usage.output), reasoning: 0,
          cache: { read: Number(row.usage.cacheRead), write: 0 } } }), row.id);
    }
  })();
}
function consumer(db: TestDatabase['db']) {
  const ledger = drizzleUsageLedger(db), values = drizzleExecutionValuations(db);
  return { ledger, ingest: developmentUsageIngestion(ledger), value: valueDevelopmentUsagePage({ models: ledger, store: values,
    value: executionValuations({ store: values, pricing: drizzleExecutionPricing(db), clock: systemClock }) }) };
}
async function originalPage(f: Fixture, execution: Execution, frames: DevelopmentRunnerUsageCapture[], at: string) {
  for (const frame of frames) execution.journal.capture(execution.registration.key, frame, at);
  expect(execution.journal.info(execution.registration.key).receipt).toMatchObject({ lastSequence: frames.length, interruption: null });
  await execution.copySession();
  expect(execution.journal.read(execution.registration.key, frames.length).events).toEqual([]);
  const raw = await f.sources.offer!(execution.registration.key); if (!raw) throw new Error('Original Session page missing');
  expect(raw.events).toHaveLength(frames.length); expect(raw.events.every(event => event.capture.version === 1)).toBe(true);
  const pricing = drizzleExecutionPricing(database.db), price = await pricing.get(execution.registration.identity);
  if (!price) throw new Error('Original acceptance price missing');
  const registration = structuredClone(execution.registration);
  const owner = { registration, price, nativeSelection: { version: 2 as const, expectedNamespace: 'acceptance-native-lineage' } };
  expect(() => prepareDevelopmentUsagePage(raw, owner, registration, price)).toThrow();
  const page = await prepareDevelopmentSourcePage(raw, owner, registration, price, undefined);
  if ('kind' in page) throw new Error('Original legacy facts must stay legacy');
  expect(page.source).toEqual(raw); expect(page.context.selection?.version).toBe(2);
  const c = consumer(database.db); await c.ingest(page); await c.value(page);
  // Simulate a lost source ACK: the original positive page remains offered after the COMMIT.
  expect(await f.sources.offer!(execution.registration.key)).toEqual(raw);
  return page;
}
async function observations(ledger: ReturnType<typeof drizzleUsageLedger>, scope: UsageTaskScope, at: string) {
  const items: UsageObservation[] = []; let cursor: string | null = null, snapshotId: string | undefined;
  do {
    const page = await ledger.snapshot(scope, { limit: 2, ...(snapshotId ? { snapshotId } : {}), ...(cursor ? { cursor } : {}) }, Date.parse(at), 0);
    items.push(...page.items); cursor = page.nextCursor; snapshotId = page.snapshotId;
  } while (cursor !== null);
  return items;
}
describe.skipIf(!available)('original v2 admission with actual legacy frames', () => {
  test('all nine original frames retain five four-bucket CNY calls through restart, replay and a later same-step v2 pass', async () => {
    const a = await nativeNumericFixture(database), b = await nativeNumericFixture(database);
    try {
      const ea = await a.execution(false), eb = await b.execution(false, { identity: ea.registration.identity });
      const pa = await nativeNumericPrice(database, ea.registration), pb = await nativeNumericPrice(database, eb.registration);
      const at = new Date().toISOString(), child1 = a.root + ':child:1', child2 = a.root + ':child:2';
      const a1 = buckets('7338', '2304', '181'), a2 = buckets('311', '9600', '14');
      const c1 = buckets('2934', '5184', '2'), c2 = buckets('5878', '2240', '3'), b1 = buckets('7373', '2240', '3');
      populate(a, [{ id: 'a1', usage: a1 }, { id: 'a2', usage: a2 }, { id: 'child1', session: child1, usage: c1 }, { id: 'child2', session: child2, usage: c2 }]);
      populate(b, [{ id: 'b1', usage: b1 }]);
      const pageA = await originalPage(a, ea, [proof(a, 'pending', 4, 3, at), capture(a, 'a1', a1, 1, at), capture(a, 'a2', a2, 2, at),
        { version: 1, diagnostics: [], measurements: [capture(a, 'a1', a1, 3, at).measurements[0]!, capture(a, 'a2', a2, 4, at).measurements[0]!,
          capture(a, 'child1', c1, 5, at, child1).measurements[0]!, capture(a, 'child2', c2, 6, at, child2).measurements[0]!] }, proof(a, 'complete', 4, 3, at)], at);
      const pageB = await originalPage(b, eb, [proof(b, 'pending', 1, 1, at), capture(b, 'b1', b1, 1, at), capture(b, 'b1', b1, 2, at), proof(b, 'complete', 1, 1, at)], at);
      const scope = { projectId: ea.registration.identity.projectId, taskId: ea.registration.identity.taskId };
      const c = consumer(database.db), before = (await c.ledger.changes(scope, 0, 100)).persistedThrough;
      const assertValues = async (ledger: ReturnType<typeof drizzleUsageLedger>) => {
        const items = await observations(ledger, scope, at), calls = items.filter(item => item.kind === 'usage'), values = items.filter(item => item.kind === 'valuation');
        expect(calls).toHaveLength(5); expect(values).toHaveLength(5);
        for (const [bucket, total] of Object.entries({ input: '23834', cacheRead: '21568', cacheWrite: '0', output: '203' }))
          expect(calls.reduce((sum, call) => sum + BigInt(call.projection.contribution[bucket as keyof ReturnType<typeof buckets>]!), 0n).toString()).toBe(total);
        expect(values.map(v => v.amountDecimal).sort()).toEqual(['0.017276', '0.005534', '0.008476', '0.0129', '0.01589'].sort());
        expect(values.every(v => v.currency === 'CNY' && [pa.original.id, pb.original.id].includes(v.priceVersionRef!))).toBe(true);
        // Captures are a separate retained source, not usage/valuation observations.
        const captures = await database.handle.client`SELECT document,summary,finalized FROM observability.native_captures
          WHERE document->'identity'->>'projectId'=${scope.projectId} AND document->'identity'->>'taskId'=${scope.taskId}`;
        expect(captures).toHaveLength(2);
        expect(captures.every(item => item.finalized === false && item.document.development.selection.version === 2 &&
          item.document.development.sourceVerified === false && item.summary.state === 'partial' && item.summary.issues.includes('native-evidence-incomplete'))).toBe(true);
        return calls;
      };
      await assertValues(c.ledger);
      await pa.api.savePrice(pa.actor, pa.profile.id, { ...pa.price, expectedRevision: 1, requestKey: 'future-unrelated-999', effectiveFrom: new Date(Date.parse(pa.price.effectiveFrom) + 1).toISOString(), rates: { ...pa.price.rates, input: '999' } });
      const fresh = connectDatabase(database.url);
      try {
        const restarted = consumer(fresh.db); await restarted.ingest(pageA); await restarted.value(pageA); await restarted.ingest(pageB); await restarted.value(pageB);
        expect((await restarted.ledger.changes(scope, 0, 100)).persistedThrough).toBe(before); await assertValues(restarted.ledger);
      } finally { await fresh.close(); }
      await a.sources.acknowledge(ea.registration.key, pageA.source.through); await b.sources.acknowledge(eb.registration.key, pageB.source.through);
      expect(await a.sources.offer!(ea.registration.key)).toBeUndefined(); expect(await b.sources.offer!(eb.registration.key)).toBeUndefined();
      for (const [execution, count] of [[ea, '4'], [eb, '1']] as const) {
        await execution.persist('final'); const retained = await execution.copy(); expect(retained.passKeys).toHaveLength(1);
        const input = { passKey: retained.passKeys[0]!, scope: retained.scope, sourceId: retained.sourceId };
        const worker = nativeNumericWorker(database, execution.read), result = await worker.work(input);
        expect(result.processed).toBe(false);
        expect(result.work.previousPopulation).toMatchObject({ visited: count, held: count, issues: ['native-owner-unresolved'] });
        expect((await worker.work(input)).processed).toBe(false);
        const retainedStep = await worker.ledger.changeNativeDevelopment(input.scope, input.sourceId, async tx => {
          const pass = await tx.nativePass(input.passKey), binding = await tx.nativePageBinding(input.passKey, '0');
          const source = prepareNativeOriginalPage({ ...binding, passKey: input.passKey, pass: pass.document, original: await execution.read(pass, '0') });
          const original = originalNativeStep(source, 0), path = await tx.nativePath(input.passKey, original.step.id);
          if (!path) throw new Error('Original qualified path missing');
          return { original, path };
        });
        // Probe a real unresolved meter only in this private database, then restore its exact row.
        const missingRecordId = nativeRecordId({ id: retainedStep.original.step.stepId, sessionId: retainedStep.original.step.id,
          parentSessionId: null, ancestors: [], occurredAt: at, actualModel: numericModel, usage: buckets('0', '0', '0') });
        const removed = await database.handle.client`DELETE FROM observability.usage_projections
          WHERE document->'identity'->>'executionId'=${execution.registration.identity.executionId}
            AND document->>'recordId'=${missingRecordId} RETURNING meter_key,task_key,document`;
        try {
          expect(removed).toHaveLength(1);
          await expect(readNativeLegacyOwners(database.db, jsonHash(scope), retainedStep.path, retainedStep.original)).rejects.toMatchObject({ kind: 'conflict' });
        } finally {
          for (const row of removed) await database.handle.client`INSERT INTO observability.usage_projections(meter_key,task_key,document)
            VALUES(${row.meter_key},${row.task_key},${JSON.stringify(row.document)}::jsonb)`;
        }
      }
      await assertValues(c.ledger);
      const [rows] = await database.handle.client`SELECT count(*)::text AS owners FROM observability.development_native_owners`;
      expect(rows!.owners).toBe('0');
    } finally { await a.close(); await b.close(); }
  }, 60_000);
});
