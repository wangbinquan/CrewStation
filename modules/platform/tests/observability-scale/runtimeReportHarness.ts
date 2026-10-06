import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { fixedClock } from '@crewstation/kernel';
import { originalReportSnapshotSession } from '@crewstation/persistence';
import { createFakeK8sClient } from '@crewstation/k8s';
import { createTestDatabase } from '@crewstation/testkit';
import { businessTaskMigrations, readBusinessObservationTaskPage, readBusinessObservationAttemptPage } from '@crewstation/module-business-task';
import { devSessionMigrations, readDevelopmentObservationTaskPage, readDevelopmentObservationAttemptPage } from '@crewstation/module-dev-session';
import { projectMigrations, readProjectObservationName } from '@crewstation/module-project';
import { agentRuntimeMigrations, readProfileObservationName } from '@crewstation/module-agent-runtime';
import { observabilityMigrations, createObservabilityModule } from '@crewstation/module-observability';
import type { ProjectId } from '@crewstation/contracts';
import { completeRuntimeFactSources } from '../../../platform/application/completeRuntimeFactSources';
import { actor, populationWindow } from './runtimeReportPopulation';

/** Exactly the platform's original owners, snapshot, module factory, worker and file spool. */
export async function runtimeReportHarness(spoolRoot?: string) {
  const tdb = await createTestDatabase([projectMigrations, agentRuntimeMigrations, businessTaskMigrations, devSessionMigrations, observabilityMigrations]);
  const root = spoolRoot ?? await mkdtemp(join(tmpdir(), 'cs-observability-population-'));
  const module = createObservabilityModule({
    db: tdb.db, reportSnapshot: originalReportSnapshotSession(tdb.handle), reportDataRoot: root,
    reportFacts: completeRuntimeFactSources({
      business: { tasks: readBusinessObservationTaskPage, attempts: readBusinessObservationAttemptPage },
      development: { tasks: readDevelopmentObservationTaskPage, attempts: readDevelopmentObservationAttemptPage },
      projectName: readProjectObservationName, profileName: readProfileObservationName,
    }),
    k8s: createFakeK8sClient(), clock: fixedClock(populationWindow.to), isAdmin: async () => true,
    authorizer: { authorize: async () => {} }, services: { resolveServiceOfProject: async () => undefined }, slots: { slotRoles: async () => undefined },
    traces: { environments: { traceKeys: async () => [], activeTraceIds: async () => [], list: async () => [] }, deliveries: { traceKeys: async () => [], activeTraceIds: async () => [], list: async () => [] }, businessTasks: { list: async () => [] }, sessions: { summarize: async () => [], events: async () => [] } },
  });
  return { tdb, module, root,
    async build(project: ProjectId | null) {
      const started = performance.now();
      const initial = await module.api.runtimeCompleteReport(actor, project, populationWindow);
      for (const worker of module.reportWorkers) await worker.drain();
      const report = await module.api.runtimeCompleteReportStatus(actor, project, initial.reportId);
      return { report, elapsedMs: performance.now() - started };
    },
    async close() { for (const worker of module.reportWorkers) await worker.stop(); await tdb.drop(); if (spoolRoot === undefined) await rm(root, { recursive: true, force: true }); },
  };
}
export type RuntimePopulationHarness = Awaited<ReturnType<typeof runtimeReportHarness>>;
export async function physicalPopulationCounts(harness: RuntimePopulationHarness) {
  const [physical] = await harness.tdb.db.execute(sql`SELECT (SELECT count(*)::text FROM business_task.execution_operations) AS tasks, (SELECT count(*)::text FROM business_task.execution_subtasks) AS attempts, (SELECT count(*)::text FROM observability.usage_projections) AS usage, (SELECT count(*)::text FROM observability.native_steps) AS steps`);
  return physical;
}
export function removeFinalAcceptanceCapture(harness: RuntimePopulationHarness) {
  return harness.tdb.db.execute(sql`DELETE FROM observability.native_captures WHERE id='capture-2'`);
}
