import assert from 'node:assert/strict';
import { jsonHash } from '@crewstation/kernel';
import { originalReportSnapshotSession } from '@crewstation/persistence';
import type { TestDatabase } from '@crewstation/testkit';
import { completeStatisticsWorkspace } from '../../../observability/wiring';
import { selectCompleteUsage } from '../../../observability/application/completeUsageSelection';
import { completeWorkingTraversal } from '../../../observability/application/completeWorkingTraversal';
import type { UsageContributionEvidence } from '../../../observability/domain/completeUsageEvidence';
import { identityBitmap } from './runtimeReportQualification';
import { perRecordTokens, acceptanceNote } from './runtimeReportPopulation';

function summaryRecord(n: number): UsageContributionEvidence {
  return { sourceId: acceptanceNote, measurement: { invocationId: 'one-original-execution', recordId: 'summary-' + n, model: null,
    scope: { root: 'original-root', session: 'original-leaf-' + n, parentSession: 'original-root', ancestors: ['original-root'], turn: 'original-turn', turnIndex: n, level: 'self-total' } }, contribution: perRecordTokens, complete: true };
}
/** All inputs belong to one original group. The real PostgreSQL TEMP workspace owns ordering and coverage. */
export async function qualifySummaryPopulation(tdb: TestDatabase, count: number, progress: (phase: string, rows: number) => void = () => {}) {
  assert.ok(Number.isSafeInteger(count) && count > 0);
  return originalReportSnapshotSession(tdb.handle).run(async snapshot => {
    const retention = completeStatisticsWorkspace({ rows: snapshot.workspace, namespace: 'acceptance-summary', keyOf: jsonHash,
      identity: row => JSON.stringify([row.sourceId, row.measurement.invocationId, row.measurement.recordId]) });
    let started = performance.now();
    for (let first = 0; first < count; first += 1000) {
      await retention.append(Array.from({ length: Math.min(1000, count - first) }, (_, n) => summaryRecord(first + n)));
      if ((first + 1000) % 100000 === 0 || first + 1000 >= count) progress('physical-summary-temp', Math.min(first + 1000, count));
    }
    retention.seal(String(count)); const seedMs = performance.now() - started;
    started = performance.now(); const result = await selectCompleteUsage(retention.workspace); await retention.flush(); const selectMs = performance.now() - started;
    assert.equal(result.selected, String(count)); assert.equal(result.excluded, '0'); assert.equal(result.ambiguousOverlaps, '0'); assert.equal(result.unavailableSummaries, '0'); assert.equal(result.allSelectedComplete, true);
    const n = BigInt(count); assert.deepEqual(result.tokens, { input: String(n), cacheRead: String(n * 3n), cacheWrite: String(n * 5n), output: String(n * 7n) });
    assert.deepEqual(result.unknownBuckets, { input: '0', cacheRead: '0', cacheWrite: '0', output: '0' });
    const identities = identityBitmap(count); started = performance.now(); let received = 0;
    for await (const row of completeWorkingTraversal<{ record: UsageContributionEvidence; contribution: typeof perRecordTokens; quality: { ambiguous: boolean; unavailable: boolean } }>(snapshot.workspace, retention.allocationsNamespace)) {
      const match = /^summary-(0|[1-9]\d*)$/.exec(row.document.record.measurement.recordId); assert.ok(match); const original = Number(match[1]); identities.add(original);
      assert.deepEqual(row.document.record, summaryRecord(original)); assert.deepEqual(row.document.contribution, perRecordTokens); assert.deepEqual(row.document.quality, { ambiguous: false, unavailable: false }); received++;
      if (received % 100000 === 0 || received === count) progress('original-summary-allocation-eof', received);
    }
    assert.equal(identities.finish(), count);
    return { snapshotId: snapshot.snapshotId, seedMs, selectMs, eofVerificationMs: performance.now() - started, allocations: String(received), result };
  });
}
