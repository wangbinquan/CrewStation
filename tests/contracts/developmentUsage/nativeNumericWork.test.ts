import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '../../../packages/testkit';
import type { DevelopmentUsageRegistration } from '../../../packages/contracts';
import { jsonHash } from '../../../packages/kernel';
import { connectDatabase } from '../../../packages/persistence';
import { sessionMigrations } from '../../../modules/session/wiring';
import { observabilityMigrations } from '../../../modules/observability/wiring';
import { drizzleUsageLedger } from '../../../modules/observability/adapters/persistence/drizzleUsageLedger';
import { nativeDevelopmentWork } from '../../../modules/observability/application/developmentUsage/nativeDevelopmentWork';
import { nativeNumericFixture } from './nativeNumericFixture';
import { nativeNumericPrice, nativeNumericWorker } from './nativeNumericPrice';
import type { NativeDevelopmentLedgerStore } from '../../../modules/observability/ports/nativeDevelopmentLedger';

const available = await testDatabaseAvailable(); let database: TestDatabase;
beforeAll(async () => { if (available) database = await createTestDatabase([sessionMigrations, observabilityMigrations]); });
afterAll(async () => { await database?.drop(); });
describe.skipIf(!available)('actual Session PG original-page work after ordinary source ACK', () => {
  test('all 1001 original steps, 71 sessions and depth 70 reach numeric/model/CNY EOF after connection restart', async () => {
    const f = await nativeNumericFixture(database);
    try {
      const execution = await f.execution(false); await nativeNumericPrice(database, execution.registration);
      f.populate(1001, 70); const ack = await execution.persist('final'), retained = await execution.copy();
      expect(retained.passKeys).toHaveLength(1); expect(await f.sources.offer!(execution.registration.key)).toBeUndefined();
      expect(execution.journal.read(execution.registration.key, Number(ack.sourceWatermark)).events).toEqual([]);
      const input = { passKey: retained.passKeys[0]!, scope: retained.scope, sourceId: retained.sourceId };
      const first = await nativeNumericWorker(database, execution.read).work(input);
      expect(first.processed).toBe(false); expect(first.work.visited).toBe('100');
      const fresh = connectDatabase(database.url);
      try {
        const resumedDatabase = { ...database, db: fresh.db };
        let result = await nativeNumericWorker(resumedDatabase, execution.read).work(input);
        while (!result.processed) result = await nativeNumericWorker(resumedDatabase, execution.read).work(input);
        expect(result.work).toMatchObject({ visited: '1001', held: '0', numericEof: true, valuationEof: true });
      } finally { await fresh.close(); }
      const [counts] = await database.handle.client`SELECT
        (SELECT count(*)::text FROM observability.development_native_owners WHERE task_key=(SELECT task_key FROM observability.development_native_passes WHERE pass_key=${input.passKey})) AS owners,
        (SELECT count(*)::text FROM observability.usage_projections WHERE task_key=(SELECT task_key FROM observability.development_native_passes WHERE pass_key=${input.passKey})) AS usage,
        (SELECT count(*)::text FROM observability.execution_valuations WHERE task_key=(SELECT task_key FROM observability.development_native_passes WHERE pass_key=${input.passKey})) AS valuations,
        (SELECT count(*)::text FROM observability.development_native_paths WHERE pass_key=${input.passKey}) AS sessions,
        (SELECT max(depth::numeric)::text FROM observability.development_native_paths WHERE pass_key=${input.passKey}) AS depth`;
      expect(counts).toEqual({ owners: '1001', usage: '1001', valuations: '1001', sessions: '71', depth: '70' });
      const [total] = await database.handle.client`SELECT sum((v.document->>'amountDecimal')::numeric)::text AS cny,
        count(*) filter (where v.document->>'currency'='CNY' AND v.document->>'completeness'='complete')::text AS complete
        FROM observability.execution_valuations v WHERE task_key=(SELECT task_key FROM observability.development_native_passes WHERE pass_key=${input.passKey})`;
      expect(total).toEqual({ cny: '1.0435425', complete: '1001' });
      const [head] = await database.handle.client`SELECT sequence::text FROM observability.usage_heads
        WHERE task_key=(SELECT task_key FROM observability.development_native_passes WHERE pass_key=${input.passKey})`;
      expect(head!.sequence).toBe('2002');
      const rows = await database.handle.client`SELECT document FROM observability.development_native_owners
        WHERE task_key=(SELECT task_key FROM observability.development_native_passes WHERE pass_key=${input.passKey})`;
      expect(rows.every(row => !JSON.stringify(row.document).includes('amountDecimal') && !JSON.stringify(row.document).includes('"input"'))).toBe(true);
    } finally { await f.close(); }
  }, 120_000);
  test('numeric, model, owner, reference, task head and work cursor roll back together while copied raw pages survive', async () => {
    const f = await nativeNumericFixture(database);
    try {
      const execution = await f.execution(false); await nativeNumericPrice(database, execution.registration);
      f.populate(3, 0); await execution.persist('final'); const retained = await execution.copy();
      const ledger = drizzleUsageLedger(database.db); let claims = 0;
      const failing: NativeDevelopmentLedgerStore = { ...ledger, changeNativeDevelopment: (scope, source, work) =>
        ledger.changeNativeDevelopment(scope, source, tx => work({ ...tx, nativeClaim: async (receipt, path) => {
          await tx.nativeClaim(receipt, path); if (++claims === 2) throw new Error('actual numeric transaction interrupted');
        } })) };
      const input = { passKey: retained.passKeys[0]!, scope: retained.scope, sourceId: retained.sourceId };
      await expect(nativeDevelopmentWork({ store: failing, read: execution.read, now: () => new Date().toISOString(), value: async () => {} })(input)).rejects.toThrow('actual numeric transaction interrupted');
      const [counts] = await database.handle.client`SELECT
        (SELECT count(*)::text FROM observability.usage_projections WHERE task_key=(SELECT task_key FROM observability.development_native_passes WHERE pass_key=${input.passKey})) AS usage,
        (SELECT count(*)::text FROM observability.development_native_owners WHERE task_key=(SELECT task_key FROM observability.development_native_passes WHERE pass_key=${input.passKey})) AS owners,
        (SELECT count(*)::text FROM observability.development_native_work WHERE pass_key=${input.passKey}) AS work,
        (SELECT sequence::text FROM observability.usage_heads WHERE task_key=(SELECT task_key FROM observability.development_native_passes WHERE pass_key=${input.passKey})) AS head`;
      expect(counts).toEqual({ usage: '0', owners: '0', work: '0', head: '0' });
      expect(await f.sources.offer!(execution.registration.key)).toBeUndefined();
      expect((await nativeNumericWorker(database, execution.read).work(input)).processed).toBe(true);
    } finally { await f.close(); }
  });
  test('valuation failure keeps committed numeric references and retries the original price without recounting usage', async () => {
    const f = await nativeNumericFixture(database);
    try {
      const execution = await f.execution(false), price = await nativeNumericPrice(database, execution.registration);
      f.populate(1, 0); await execution.persist('final'); const retained = await execution.copy();
      const input = { passKey: retained.passKeys[0]!, scope: retained.scope, sourceId: retained.sourceId }, worker = nativeNumericWorker(database, execution.read);
      await expect(nativeDevelopmentWork({ store: worker.ledger, read: execution.read, now: () => new Date().toISOString(),
        value: async () => { throw new Error('actual valuation unavailable'); } })(input)).rejects.toThrow('actual valuation unavailable');
      await price.api.savePrice(price.actor, price.profile.id, { ...price.price, expectedRevision: 1, requestKey: 'later-999', effectiveFrom: new Date(Date.parse(price.price.effectiveFrom) + 1).toISOString(), rates: { ...price.price.rates, input: '999' } });
      const completed = await worker.work(input); expect(completed.processed).toBe(true);
      const [value] = await database.handle.client`SELECT document FROM observability.execution_valuations
        WHERE task_key=(SELECT task_key FROM observability.development_native_passes WHERE pass_key=${input.passKey})`;
      expect(value!.document).toMatchObject({ currency: 'CNY', amountDecimal: '0.0000425', priceVersionRef: price.original.id });
      const [count] = await database.handle.client`SELECT count(*)::text AS total FROM observability.usage_evidence
        WHERE document->'identity'->>'executionId'=${execution.registration.key.executionId}`;
      expect(count!.total).toBe('1');
    } finally { await f.close(); }
  });
  test('unknown root birth preserves raw evidence and explicit held population without inventing a zero baseline', async () => {
    const f = await nativeNumericFixture(database);
    try {
      const execution = await f.execution(false); await nativeNumericPrice(database, execution.registration);
      f.populate(1, 0, false); await execution.persist('final'); const retained = await execution.copy();
      const input = { passKey: retained.passKeys[0]!, scope: retained.scope, sourceId: retained.sourceId };
      const result = await nativeNumericWorker(database, execution.read).work(input);
      expect(result.processed).toBe(false); expect(result.work.previousPopulation).toMatchObject({ visited: '1', held: '1', issues: ['native-root-birth-unproved'] });
      const [rows] = await database.handle.client`SELECT count(*)::text AS total FROM observability.usage_projections
        WHERE task_key=(SELECT task_key FROM observability.development_native_passes WHERE pass_key=${input.passKey})`;
      expect(rows!.total).toBe('0');
      expect(await f.sources.nativePage!(execution.registration.key, (await workerPass(execution.registration, retained.passKeys[0]!)).progress.identity.passId, '0')).toBeDefined();
    } finally { await f.close(); }
  });
});
async function workerPass(r: DevelopmentUsageRegistration, passKey: string) {
  return drizzleUsageLedger(database.db).changeNativeDevelopment({ projectId: r.identity.projectId, taskId: r.identity.taskId },
    'development:' + jsonHash(r), tx => tx.nativePass(passKey));
}
