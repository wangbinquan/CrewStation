import { afterEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { jsonHash } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { originalReportSnapshotSession } from '@crewstation/persistence';
import { readBusinessObservationTaskPage } from '@crewstation/module-business-task';
import type { UsageValuation } from '@crewstation/contracts';
import type { CompleteSourcePage } from '../../../observability/ports/completeReport';
import { completeRuntimeLedgerSources } from '../../../observability/adapters/persistence/completeRuntimeLedgerSources';
import { runtimeReportHarness, type RuntimePopulationHarness } from './runtimeReportHarness';
import { seedRuntimePopulation, projectId, populationWindow } from './runtimeReportPopulation';
import { expectedYuan, qualifyRuntimePopulation } from './runtimeReportQualification';

const available = await testDatabaseAvailable();
let harness: RuntimePopulationHarness | undefined;
afterEach(async () => { await harness?.close(); harness = undefined; });
interface Plan { 'Index Name'?: string; Plans?: Plan[] }
function indexes(plan: Plan): string[] { return [...(plan['Index Name'] ? [plan['Index Name']] : []), ...(plan.Plans ?? []).flatMap(indexes)]; }

describe.skipIf(!available)('original task valuation index and complete report population', () => {
  // CI 37425761713 retained all 10M valuations but spent its remaining budget in the original system build.
  // The actual reader filters task_key and orders meter_key; the old schema had only the global meter PK.
  test('the actual PostgreSQL plan uses the task index and the original reader visits every valuation EOF', async () => {
    harness = await runtimeReportHarness();
    await seedRuntimePopulation(harness.tdb, 64, 100);
    await harness.tdb.db.execute(sql`ANALYZE observability.execution_valuations`);
    await originalReportSnapshotSession(harness.tdb.handle).run(async snapshot => {
      const tasks = await readBusinessObservationTaskPage(snapshot.executor, { ...populationWindow, projectId, pageSize: 100 });
      expect(tasks.items).toHaveLength(64); expect(tasks.nextCursor).toBeNull();
      const task = tasks.items[0]!, taskKey = jsonHash({ projectId: task.projectId, taskId: task.id });
      const plan = (await snapshot.executor.execute<{ 'QUERY PLAN': { Plan: Plan }[] }>(sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
        SELECT meter_key,document FROM observability.execution_valuations
        WHERE task_key=${taskKey} AND document->'identity'->>'projectId'=${task.projectId}
          AND document->'identity'->>'taskId'=${task.id} AND document->'identity'->>'sourceKind' IS NULL
        ORDER BY meter_key LIMIT 38`))[0]!['QUERY PLAN'][0]!.Plan;
      console.info(JSON.stringify({ phase: 'original-valuation-query-plan', plan }));
      expect(indexes(plan)).toContain('execution_valuation_task_meter');
      const seen = new Set<string>();
      for (const original of tasks.items) {
        const source = completeRuntimeLedgerSources(snapshot.executor, original, snapshot.snapshotId, 37).valuations;
        let cursor: string | null = null, received = 0;
        for (;;) {
          const page: CompleteSourcePage<UsageValuation> = await source.next(cursor);
          expect(page.snapshotId).toBe(snapshot.snapshotId);
          for (const value of page.items) {
            expect(value.identity.taskId).toBe(original.id); expect(value.identity.projectId).toBe(projectId);
            expect(value.currency).toBe('CNY'); expect(seen.has(value.recordId)).toBe(false); seen.add(value.recordId);
            if (value.availability !== 'priced') throw new Error('Original acceptance valuation disappeared');
            expect(value.amountDecimal).toBe(expectedYuan(1)); received++;
          }
          if (page.nextCursor === null) break; expect(page.nextCursor).not.toBe(cursor); cursor = page.nextCursor;
        }
        expect(received).toBe(100);
      }
      expect([...seen].sort()).toEqual(Array.from({ length: 6400 }, (_, n) => 'record-' + n).sort());
    });
  }, 30000);

  test('system and project reports retain every original task, four buckets and CNY valuation after the index change', async () => {
    harness = await runtimeReportHarness();
    await seedRuntimePopulation(harness.tdb, 12, 101);
    const system = await qualifyRuntimePopulation(harness, null, 12, 101);
    const project = await qualifyRuntimePopulation(harness, projectId, 12, 101);
    expect(system.tasks).toBe('12'); expect(project.tasks).toBe('12');
    expect(system.calls).toBe('1212'); expect(project.calls).toBe('1212');
  }, 30000);
});
