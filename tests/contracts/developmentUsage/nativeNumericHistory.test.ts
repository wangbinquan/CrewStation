import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '../../../packages/testkit';
import { sessionMigrations } from '../../../modules/session/wiring';
import { observabilityMigrations } from '../../../modules/observability/wiring';
import { nativeNumericFixture, numericModel } from './nativeNumericFixture';
import { appendUsageEvidence } from '../../../modules/observability/application/usageIngestion';
import { jsonHash } from '../../../packages/kernel';
import { nativeNumericPrice, nativeNumericWorker } from './nativeNumericPrice';
import type { UsageRecord } from '../../../packages/contracts';

const available = await testDatabaseAvailable(); let database: TestDatabase;
beforeAll(async () => { if (available) database = await createTestDatabase([sessionMigrations, observabilityMigrations]); });
afterAll(async () => { await database?.drop(); });
const part = (input: number) => JSON.stringify({ type: 'step-finish', tokens: { input, output: 2, reasoning: 1, cache: { read: 3, write: 5 } } });
async function drainOriginalPages(worker: ReturnType<typeof nativeNumericWorker>, input: Parameters<ReturnType<typeof nativeNumericWorker>['work']>[0]) {
  for (;;) { const result = await worker.work(input); if (result.processed || result.work.blockedAtDependencies) return result; }
}

describe.skipIf(!available)('actual original native usage history and stable recovery', () => {
  test('a different real journal uses actual complete before, corrects the original meter and keeps its original CNY fee', async () => {
    const f = await nativeNumericFixture(database);
    try {
      const first = await f.execution(false), oldPrice = await nativeNumericPrice(database, first.registration);
      f.populate(1, 0); f.db.query('UPDATE part SET data=? WHERE id=?').run(part(10), 'actual-step-000000');
      await first.persist('final'); const retained = await first.copy();
      expect((await nativeNumericWorker(database, first.read).work({ ...retained, passKey: retained.passKeys[0]! })).processed).toBe(true);
      const [row] = await database.handle.client`SELECT document FROM observability.usage_projections
        WHERE document->'identity'->>'executionId'=${first.registration.key.executionId}`;
      const original = row!.document as UsageRecord;
      const second = await f.execution(true, first.registration), newPrice = await nativeNumericPrice(database, second.registration, '9');
      expect(second.registration.key.journalId).not.toBe(first.registration.key.journalId);
      await second.persist('baseline'); await second.copy();
      f.db.query('UPDATE part SET data=? WHERE id=?').run(part(15), 'actual-step-000000'); f.addStep('new-actual-step', 3);
      await second.persist('final'); const next = await second.copy();
      const result = await nativeNumericWorker(database, second.read).work({ ...next, passKey: next.passKeys[0]! });
      expect(result.processed).toBe(true); expect(result.work).toMatchObject({ visited: '2', held: '0', numericEof: true, valuationEof: true });
      const rows = await database.handle.client`SELECT document FROM observability.usage_projections
        WHERE task_key=(SELECT task_key FROM observability.development_native_passes WHERE pass_key=${next.passKeys[0]!})`;
      expect(rows).toHaveLength(2);
      const revised = rows.map(r => r.document as UsageRecord).find(r => r.identity.executionId === original.identity.executionId)!;
      expect({ identity: revised.identity, sourceId: revised.sourceId, recordId: revised.recordId, occurredAt: revised.occurredAt, scope: revised.scope })
        .toEqual({ identity: original.identity, sourceId: original.sourceId, recordId: original.recordId, occurredAt: original.occurredAt, scope: original.scope });
      expect(revised.projection.contribution).toEqual({ input: '15', cacheRead: '3', cacheWrite: '5', output: '3' });
      const values = await database.handle.client`SELECT document FROM observability.execution_valuations
        WHERE task_key=(SELECT task_key FROM observability.development_native_passes WHERE pass_key=${next.passKeys[0]!})`;
      expect(values.map(r => ({ amount: r.document.amountDecimal, price: r.document.priceVersionRef })).sort((a,b) => a.amount.localeCompare(b.amount)))
        .toEqual([{ amount: '0.0000675', price: newPrice.original.id }, { amount: '0.0000705', price: oldPrice.original.id }]);
    } finally { await f.close(); }
  });
  test('known buckets remain valued when the actual WAL output bucket is absent', async () => {
    const f = await nativeNumericFixture(database);
    try {
      const execution = await f.execution(false); await nativeNumericPrice(database, execution.registration);
      f.populate(0, 0); f.addStep('unknown-output', 7, f.root, true); await execution.persist('final'); const retained = await execution.copy();
      expect((await nativeNumericWorker(database, execution.read).work({ ...retained, passKey: retained.passKeys[0]! })).processed).toBe(true);
      const [usage] = await database.handle.client`SELECT document FROM observability.usage_projections WHERE document->'identity'->>'executionId'=${execution.registration.key.executionId}`;
      expect(usage!.document.projection).toMatchObject({ complete: false, contribution: { input: '7', cacheRead: '3', cacheWrite: '5', output: null } });
      const [value] = await database.handle.client`SELECT document FROM observability.execution_valuations WHERE document->'identity'->>'executionId'=${execution.registration.key.executionId}`;
      expect(value!.document).toMatchObject({ currency: 'CNY', completeness: 'partial', amountDecimal: '0.0000305' });
    } finally { await f.close(); }
  });
  test('a held unchanged source cannot invalidate accepted reports on every worker tick', async () => {
    const f = await nativeNumericFixture(database);
    try {
      const execution = await f.execution(false); await nativeNumericPrice(database, execution.registration);
      f.populate(1, 0, false); await execution.persist('final'); const retained = await execution.copy();
      const input = { ...retained, passKey: retained.passKeys[0]! }, worker = nativeNumericWorker(database, execution.read);
      expect((await worker.work(input)).processed).toBe(false);
      const clock = async () => (await database.handle.client`SELECT count(*)::text AS rows FROM observability.runtime_report_revisions`)[0]!.rows;
      const before = await clock(), retainedWork = await worker.work(input);
      expect(retainedWork.processed).toBe(false); expect(retainedWork.work.previousPopulation).toMatchObject({ visited: '1', held: '1' });
      // Repeated original-head reads must not issue no-op writes that revoke every accepted report.
      expect(await clock()).toBe(before);
    } finally { await f.close(); }
  });
  test('completed source replay has stable numeric/valuation population and report revision', async () => {
    const f = await nativeNumericFixture(database);
    try {
      const execution = await f.execution(false); await nativeNumericPrice(database, execution.registration);
      f.populate(1, 0); await execution.persist('final'); const retained = await execution.copy();
      const input = { ...retained, passKey: retained.passKeys[0]! }, worker = nativeNumericWorker(database, execution.read);
      expect((await worker.work(input)).processed).toBe(true);
      const clock = async () => (await database.handle.client`SELECT count(*)::text AS rows FROM observability.runtime_report_revisions`)[0]!.rows;
      const before = await clock(); expect((await worker.work(input)).processed).toBe(true);
      expect(await clock()).toBe(before);
      const [counts] = await database.handle.client`SELECT
        (SELECT count(*)::text FROM observability.usage_evidence WHERE document->'identity'->>'executionId'=${execution.registration.key.executionId}) AS evidence,
        (SELECT count(*)::text FROM observability.execution_valuations WHERE document->'identity'->>'executionId'=${execution.registration.key.executionId}) AS valuations`;
      expect(counts).toEqual({ evidence: '1', valuations: '1' });
    } finally { await f.close(); }
  });
  test('an original Session raw-document mismatch is rejected after source ACK before any number is appended', async () => {
    const f = await nativeNumericFixture(database);
    try {
      const execution = await f.execution(false); await nativeNumericPrice(database, execution.registration);
      f.populate(1, 0); await execution.persist('final'); const retained = await execution.copy();
      const worker = nativeNumericWorker(database, async (pass, ordinal) => ({ ...(await execution.read(pass, ordinal)), document: '{}' }));
      await expect(worker.work({ ...retained, passKey: retained.passKeys[0]! })).rejects.toThrow();
      const [usage] = await database.handle.client`SELECT count(*)::text AS rows FROM observability.usage_projections WHERE document->'identity'->>'executionId'=${execution.registration.key.executionId}`;
      expect(usage!.rows).toBe('0'); expect(await f.sources.offer!(execution.registration.key)).toBeUndefined();
    } finally { await f.close(); }
  });
  // RFC-034 N4 review P2-01: a non-final page has its own original ACK watermark.
  test('a complete multi-page before bridges each actual page instead of comparing every step with the final EOF watermark', async () => {
    const f = await nativeNumericFixture(database);
    try {
      const first = await f.execution(false); await nativeNumericPrice(database, first.registration);
      f.populate(2, 0);
      f.db.query('UPDATE part SET data=? WHERE id=?').run(part(10), 'actual-step-000000');
      f.db.query('UPDATE part SET data=? WHERE id=?').run(part(11), 'actual-step-000001');
      await first.persist('final', 1); const original = await first.copy();
      expect((await drainOriginalPages(nativeNumericWorker(database, first.read), { ...original, passKey: original.passKeys[0]! })).processed).toBe(true);
      const second = await f.execution(true, first.registration); await nativeNumericPrice(database, second.registration, '9');
      await second.persist('baseline', 1); const baseline = await second.copy();
      const pages = await database.handle.client`SELECT document->'ack'->>'sourceWatermark' AS watermark
        FROM observability.development_native_pages WHERE pass_key=${baseline.passKeys[0]!} ORDER BY ordinal::numeric`;
      expect(pages.length).toBeGreaterThan(1); expect(new Set(pages.map(row => row.watermark)).size).toBe(pages.length);
      f.db.query('UPDATE part SET data=? WHERE id=?').run(part(15), 'actual-step-000000'); f.addStep('new-actual-step', 3);
      await second.persist('final', 1); const retained = await second.copy();
      const result = await drainOriginalPages(nativeNumericWorker(database, second.read), { ...retained, passKey: retained.passKeys[0]! });
      expect(result.processed).toBe(true);
      expect(result.work).toMatchObject({ visited: '3', held: '0', numericEof: true, valuationEof: true });
      const rows = await database.handle.client`SELECT document FROM observability.usage_projections
        WHERE task_key=(SELECT task_key FROM observability.development_native_passes WHERE pass_key=${retained.passKeys[0]!})`;
      expect(rows).toHaveLength(3);
      expect(rows.filter(row => row.document.identity.executionId === first.registration.key.executionId)
        .map(row => row.document.projection.contribution.input).sort()).toEqual(['11', '15']);
    } finally { await f.close(); }
  });
  // RFC-034 N4 review P2-02: the original numeric anchor must allow an independently retained actual model refinement.
  test('ordinary actual model evidence refines an unknown native model while the original anchored numbers and CNY fee remain authoritative', async () => {
    const f = await nativeNumericFixture(database);
    try {
      const execution = await f.execution(false), price = await nativeNumericPrice(database, execution.registration);
      f.populate(1, 0); f.db.query('UPDATE part SET data=? WHERE id=?').run(part(10), 'actual-step-000000');
      f.db.query('UPDATE message SET data=? WHERE id=?').run(JSON.stringify({ role: 'assistant' }), 'actual-step-000000');
      await execution.persist('final'); const retained = await execution.copy(), worker = nativeNumericWorker(database, execution.read);
      expect((await worker.work({ ...retained, passKey: retained.passKeys[0]! })).processed).toBe(true);
      const [row] = await database.handle.client`SELECT document FROM observability.usage_projections
        WHERE document->'identity'->>'executionId'=${execution.registration.key.executionId}`;
      const original = row!.document as UsageRecord, ref = { identity: original.identity, sourceId: original.sourceId, recordId: original.recordId };
      expect(original.modelRef).toBeNull();
      f.db.query('UPDATE message SET data=? WHERE id=?').run(JSON.stringify({ role: 'assistant', providerID: numericModel.provider, modelID: numericModel.model }), 'actual-step-000000');
      const actualMessage = JSON.parse((f.db.query('SELECT data FROM message WHERE id=?').get('actual-step-000000') as { data: string }).data);
      const actualModel = { provider: actualMessage.providerID as string, model: actualMessage.modelID as string, condition: null };
      const { projection: _, ...raw } = original;
      const measurement = { ...raw, revision: raw.revision + 1, modelRef: jsonHash(actualModel), usage: { ...raw.usage, input: '999' } };
      await worker.ledger.changeDevelopment(retained.scope, retained.sourceId, async tx => {
        await tx.developmentModel({ meter: ref, revision: measurement.revision, streamSourceId: retained.sourceId,
          sequence: 2, index: 0, turn: measurement.scope!.turn, turnIndex: measurement.scope!.turnIndex,
          measurementFingerprint: jsonHash(measurement), actualModel, modelRef: measurement.modelRef });
        await appendUsageEvidence(tx, { eventId: 'ordinary-actual-model:' + jsonHash(ref), measurement });
      });
      await worker.value(ref);
      const current = await worker.ledger.changeDevelopment(retained.scope, retained.sourceId, tx => tx.current(original));
      expect(current).toMatchObject({ modelRef: jsonHash(actualModel), scope: original.scope,
        projection: { contribution: { input: '10', cacheRead: '3', cacheWrite: '5', output: '3' }, modelRevision: 2 } });
      const [value] = await database.handle.client`SELECT document FROM observability.execution_valuations
        WHERE document->'identity'->>'executionId'=${execution.registration.key.executionId}`;
      expect(value!.document).toMatchObject({ currency: 'CNY', completeness: 'complete', amountDecimal: '0.0000605', priceVersionRef: price.original.id });
    } finally { await f.close(); }
  });
});
