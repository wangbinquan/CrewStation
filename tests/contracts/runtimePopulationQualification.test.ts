// Small physical regression for the very same hosted full-population qualification path.
import { afterEach, describe, expect, test } from 'bun:test';
import { testDatabaseAvailable } from '../../packages/testkit/database';
import { runtimeReportHarness, physicalPopulationCounts, removeFinalAcceptanceCapture, type RuntimePopulationHarness } from '../../modules/platform/tests/observability-scale/runtimeReportHarness';
import { populationDimensions, projectId, seedRuntimePopulation } from '../../modules/platform/tests/observability-scale/runtimeReportPopulation';
import { qualifyRuntimePopulation, identityBitmap } from '../../modules/platform/tests/observability-scale/runtimeReportQualification';
import { qualifySummaryPopulation } from '../../modules/platform/tests/observability-scale/runtimeSummaryQualification';

const available = await testDatabaseAvailable(); let harness: RuntimePopulationHarness | undefined;
afterEach(async () => { await harness?.close(); harness = undefined; });
describe.skipIf(!available)('original physical runtime population qualification', () => {
  test('system and project reports traverse all physical Task, attempt and CNY allocations to EOF', async () => {
    harness = await runtimeReportHarness(); await seedRuntimePopulation(harness.tdb, 3, 2);
    // Port-array cohort fixtures did not exercise original platform owner SQL and formal worker composition.
    const system = await qualifyRuntimePopulation(harness, null, 3, 2), project = await qualifyRuntimePopulation(harness, projectId, 3, 2);
    expect(system.report.summary.metrics).toEqual(project.report.summary.metrics); expect(system.report.header.snapshotId).not.toBe(project.report.header.snapshotId);
    const physical = await physicalPopulationCounts(harness);
    expect(physical).toEqual({ tasks: '3', attempts: '3', usage: '6', steps: '6' });
  }, 60000);
  test('same-group self-total allocation retains every original leaf using PostgreSQL TEMP', async () => {
    harness = await runtimeReportHarness(); const receipt = await qualifySummaryPopulation(harness.tdb, 7);
    expect(receipt.allocations).toBe('7'); expect(receipt.result.tokens).toEqual({ input: '7', cacheRead: '21', cacheWrite: '35', output: '49' });
  }, 60000);
  test('a missing original native capture preserves recorded values without declaring complete statistics', async () => {
    harness = await runtimeReportHarness(); await seedRuntimePopulation(harness.tdb, 3, 2);
    await removeFinalAcceptanceCapture(harness);
    const built = await harness.build(null); expect(built.report.state).toBe('not-ready');
    if (built.report.state !== 'not-ready') throw new Error('Incomplete native evidence became ready');
    expect(built.report.facts?.summary.tasks).toBe('3'); expect(built.report.facts?.summary.metrics.recordedUsage?.tokens).toEqual({ input: '6', cacheRead: '18', cacheWrite: '30', output: '42', total: '96' });
    expect(built.report.facts?.summary.metrics.recordedCost?.amount).toBe('0.0003');
  }, 60000);
});
test('acceptance population and exact identity oracle reject empty, fractional and duplicate inputs', () => {
  for (const [tasks, calls] of [[0, 1], [1, 0], [1.5, 2], [1, Number.NaN]]) expect(() => populationDimensions(tasks!, calls!)).toThrow();
  const identities = identityBitmap(2); identities.add(0); expect(() => identities.add(0)).toThrow('Duplicate'); expect(() => identities.finish()).toThrow('missing');
});
