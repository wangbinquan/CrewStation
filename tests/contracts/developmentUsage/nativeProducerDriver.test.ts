// Controlled process output with actual runtime driver → WAL → Session PostgreSQL → ledger/CNY.
// The configured rates and model are acceptance-only; no supplier invocation or bill.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '../../../packages/testkit';
import type { RunnerCommand, UsageObservation } from '../../../packages/contracts';
import { jsonHash } from '../../../packages/kernel';
import { connectDatabase } from '../../../packages/persistence';
import { sessionMigrations } from '../../../modules/session/wiring';
import { observabilityMigrations } from '../../../modules/observability/wiring';
import { developmentRegistration } from '../../../modules/session/tests/developmentUsageFixtures';
import { drizzleDevelopmentUsageStore } from '../../../modules/session/adapters/persistence/developmentUsage';
import { drizzleDevelopmentUsageSourceStore } from '../../../modules/session/adapters/persistence/developmentUsageSources';
import { ingestDevelopmentUsage } from '../../../modules/session/application/developmentUsageIngestion';
import { prepareDevelopmentNativePacket } from '../../../modules/observability/domain/developmentUsage/packet';
import { drizzleUsageLedger } from '../../../modules/observability/adapters/persistence/drizzleUsageLedger';
import { readDevelopmentNativePage } from '../../../runtimes/task/src/agents/developmentNativePageReader';
import { nativeProducerFixture, captureNativeProducerTurns } from '../../../runtimes/task/src/agents/tests/nativeProducerFixture';
import { numericModel } from './nativeNumericFixture';
import { nativeNumericPrice, nativeNumericWorker } from './nativeNumericPrice';

const available = await testDatabaseAvailable(); let database: TestDatabase;
beforeAll(async () => { if (available) database = await createTestDatabase([sessionMigrations, observabilityMigrations]); });
afterAll(async () => { await database?.drop(); });
describe.skipIf(!available)('actual dual-turn producer retained numeric/CNY attribution', () => {
  for (const resume of [false, true]) test(`${resume ? 'initial resume retains an unresolved old step' : 'fresh'} and second resume count each new step once after source ACK and connection restart`, async () => {
    const registration = developmentRegistration(), f = nativeProducerFixture(resume, registration, numericModel);
    const usage = drizzleDevelopmentUsageStore(database.db), sources = drizzleDevelopmentUsageSourceStore(database.db);
    await usage.register(registration); const price = await nativeNumericPrice(database, registration);
    const captured = await captureNativeProducerTurns(f, resume, { acknowledge: false });
    expect(captured.frames.every(event => event.capture.version === 2)).toBe(true);
    const send = async (_id: typeof registration.runtimeTaskId, command: RunnerCommand) => {
      if (command.type === 'developmentUsageInfo') return f.journal.info(command.key);
      if (command.type === 'readDevelopmentUsageEvents') return f.journal.read(command.key, command.after, command.limit);
      if (command.type === 'readDevelopmentNativePage') return readDevelopmentNativePage(f.journal, command.key, command.passId, command.ordinal, command.afterByte);
      if (command.type === 'ackDevelopmentUsageEvents') return f.journal.acknowledge(command.key, command.through);
      throw new Error('Unexpected controlled original source command');
    };
    for (;;) {
      const row = (await usage.get(registration.runtimeTaskId, registration.key))!;
      if (row.persistedThrough === captured.frames.length && row.runnerAcknowledgedThrough === row.persistedThrough) break;
      await ingestDevelopmentUsage({ store: usage, send }, row);
    }
    const ledger = drizzleUsageLedger(database.db), passKeys = new Set<string>();
    const scope = { projectId: registration.identity.projectId, taskId: registration.identity.taskId }, sourceId = 'development:' + jsonHash(registration);
    for (;;) {
      const source = await sources.offer!(registration.key); if (!source) break;
      await ledger.changeDevelopment(scope, sourceId, async tx => {
        for (const event of source.events) {
          if (event.capture.version !== 2) throw new Error('Actual original v2 packet required');
          const original = await sources.nativePage!(registration.key, event.capture.nativeSource.ack.identity.passId, event.capture.nativeSource.ack.ordinal);
          if (!original) throw new Error('Original Session PG page missing');
          const packet = prepareDevelopmentNativePacket({ key: registration.key, registration, ownerRegistration: structuredClone(registration),
            selection: { version: 2, expectedNamespace: f.admission.intent.nativeUsageLineageKey }, original, event });
          passKeys.add((await tx.developmentPacket(packet)).passKey);
        }
        await tx.advance('development:' + source.through, jsonHash(source));
      });
      await sources.acknowledge(registration.key, source.through);
    }
    expect(passKeys.size).toBe(resume ? 4 : 3); expect(await sources.offer!(registration.key)).toBeUndefined();
    expect(f.journal.read(registration.key, captured.frames.length).events).toEqual([]);
    const fresh = connectDatabase(database.url);
    try {
      const worker = nativeNumericWorker({ ...database, db: fresh.db }, async (pass, ordinal) => {
        const page = await sources.nativePage!(registration.key, pass.progress.identity.passId, ordinal);
        if (!page) throw new Error('Original retained page lost after source ACK'); return page;
      });
      for (const passKey of passKeys) {
        let result = await worker.work({ passKey, scope, sourceId });
        while (!result.processed && !result.work.previousPopulation) {
          expect(result.work.held).toBe('0'); expect(result.work.issues).toEqual([]);
          result = await worker.work({ passKey, scope, sourceId });
        }
        const pass = await ledger.changeNativeDevelopment(scope, sourceId, tx => tx.nativePass(passKey));
        if (resume && pass.progress.identity.phase === 'final') {
          // An unchanged pre-existing step without a historical owner must remain explicit and held.
          expect(result.processed).toBe(false); expect(result.work.previousPopulation).toMatchObject({ held: '1', issues: ['native-owner-unresolved'] });
          expect(pass.progress.counts.steps).toBe(pass.document.preparation.turnIndex === 0 ? '2' : '3');
        } else {
          expect(result.processed).toBe(true); expect(result.work).toMatchObject({ numericEof: true, valuationEof: true, held: '0' });
        }
      }
    } finally { await fresh.close(); }
    const items: UsageObservation[] = []; let cursor: string | null = null, snapshotId: string | undefined;
    do {
      const page = await ledger.snapshot(scope, { limit: 1, ...(cursor ? { cursor } : {}), ...(snapshotId ? { snapshotId } : {}) }, Date.now(), 0);
      items.push(...page.items); cursor = page.nextCursor; snapshotId = page.snapshotId;
    } while (cursor !== null);
    const calls = items.filter(item => item.kind === 'usage'), values = items.filter(item => item.kind === 'valuation');
    expect(calls).toHaveLength(2); expect(values).toHaveLength(2);
    for (const [bucket, total] of Object.entries({ input: '25', cacheRead: '10', cacheWrite: '14', output: '32' }))
      expect(calls.reduce((sum, call) => sum + BigInt(call.projection.contribution[bucket as 'input']!), 0n).toString()).toBe(total);
    expect(values.map(value => value.amountDecimal).sort()).toEqual(['0.0001755', '0.0001775']);
    expect(values.every(value => value.currency === 'CNY' && value.priceVersionRef === price.original.id && value.completeness === 'complete')).toBe(true);
    const [head] = await database.handle.client`SELECT sequence::text FROM observability.usage_heads
      WHERE task_key=(SELECT task_key FROM observability.development_native_passes WHERE pass_key=${[...passKeys][0]!})`;
    expect(head!.sequence).toBe('4');
    const [models] = await database.handle.client`SELECT count(*)::text AS total FROM observability.development_model_evidence
      WHERE document->'meter'->'identity'->>'executionId'=${registration.runtimeTaskId}`;
    expect(models!.total).toBe('2');
  }, 120_000);
});
