import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { runtimeReportHarness } from './runtimeReportHarness';
import { projectId, seedRuntimePopulation, acceptanceNote } from './runtimeReportPopulation';
import { qualifyRuntimePopulation, qualifyReadyLatency } from './runtimeReportQualification';
import { qualifySummaryPopulation } from './runtimeSummaryQualification';

/** Fixed populations; there is deliberately no smaller-count environment variable or argument. */
async function qualify() {
  const scenario = process.env['CS_OBSERVABILITY_SCALE_MODE']; assert.ok(scenario === 'full-report' || scenario === 'self-total');
  const sourceSha = process.env['CS_OBSERVABILITY_SCALE_SHA']; assert.match(sourceSha ?? '', /^[a-f0-9]{40}$/);
  const directory = resolve(process.env['CS_OBSERVABILITY_SCALE_OUTPUT'] ?? 'test-results/rfc034-scale'); await mkdir(directory, { recursive: true });
  const startedAt = new Date().toISOString(), harness = await runtimeReportHarness(join(directory, 'spool'));
  let phase = 'created-original-database'; const progress = (next: string, rows: number) => { phase = next; console.info(JSON.stringify({ at: new Date().toISOString(), phase, rows, pid: process.pid, rssBytes: process.memoryUsage().rss })); };
  const heartbeat = setInterval(() => progress(phase, -1), 30000);
  const [database] = await harness.tdb.db.execute(sql`SELECT current_database() AS name,(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid`);
  await Bun.write(join(directory, 'original-database.json'), JSON.stringify({ database: database!['name'], oid: database!['oid'], scenario, sourceSha, startedAt }, null, 2));
  try {
    let qualification: unknown;
    if (scenario === 'full-report') {
      const started = performance.now(); await seedRuntimePopulation(harness.tdb, 100000, 100, progress); const seedMs = performance.now() - started;
      const [original] = await harness.tdb.db.execute(sql`SELECT (SELECT count(*)::text FROM business_task.execution_operations) AS tasks,(SELECT count(*)::text FROM business_task.execution_subtasks) AS attempts,(SELECT count(*)::text FROM observability.usage_projections) AS usage,(SELECT count(*)::text FROM observability.native_steps) AS steps,(SELECT count(*)::text FROM observability.native_captures) AS captures,(SELECT count(*)::text FROM observability.execution_valuations) AS valuations`);
      assert.deepEqual(original, { tasks: '100000', attempts: '100000', usage: '10000000', steps: '10000000', captures: '100000', valuations: '10000000' });
      progress('system-full-report-build', 0); const system = await qualifyRuntimePopulation(harness, null, 100000, 100, progress);
      const systemLatency = await qualifyReadyLatency(harness, null, system);
      progress('project-full-report-build', 0); const project = await qualifyRuntimePopulation(harness, projectId, 100000, 100, progress);
      const projectLatency = await qualifyReadyLatency(harness, projectId, project);
      qualification = { seedMs, original, system, systemLatency, project, projectLatency };
    } else { progress('same-group-self-total', 0); qualification = await qualifySummaryPopulation(harness.tdb, 10000000, progress); }
    await Bun.write(join(directory, 'qualification.json'), JSON.stringify({ state: 'passed', sourceSha, scenario, acceptanceNote, population: scenario === 'full-report' ? { tasks: '100000', attempts: '100000', usage: '10000000' } : { selfTotals: '10000000', groups: '1' }, startedAt, finishedAt: new Date().toISOString(), qualification }, null, 2));
    progress('all-original-eof-qualified', scenario === 'full-report' ? 100000 : 10000000); await harness.close();
  } catch (error) {
    // Retain the actual failed database until the hosted service exits; no cleanup can erase failure evidence.
    await Bun.write(join(directory, 'qualification.json'), JSON.stringify({ state: 'failed', sourceSha, scenario, startedAt, failedAt: new Date().toISOString(), phase, error: String(error) }, null, 2)); throw error;
  } finally { clearInterval(heartbeat); }
}
await qualify();
