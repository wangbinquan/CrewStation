import assert from 'node:assert/strict';
import { CompleteRuntimeTaskSummarySchema, CompleteRuntimeAttemptSummarySchema, CompleteRuntimeCallSchema,
  CompleteRuntimeProjectSchema, CompleteRuntimeProfileSchema, CompleteRuntimeModelSchema,
  type CompleteRuntimeMetricsDto, type ProjectId, type RuntimeCompleteReport, type RuntimeReportPage, type RuntimeReportSection } from '@crewstation/contracts';
import { actor, projectId, profileId, populationId, populationIdentity, modelRef, sourceId,
  originalProjectName, originalProfileName, populationDimensions } from './runtimeReportPopulation';
import type { RuntimePopulationHarness } from './runtimeReportHarness';

export function expectedTokens(records: number) {
  const n = BigInt(records); return { input: String(n), cacheRead: String(n * 3n), cacheWrite: String(n * 5n), output: String(n * 7n), total: String(n * 16n) };
}
/** Independent exact oracle: 1*1 + 3*2 + 5*3 + 7*4 = 50 yuan per million records. */
export function expectedYuan(records: number) {
  const picos = BigInt(records) * 50_000_000n, fraction = String(picos % 1_000_000_000_000n).padStart(12, '0').replace(/0+$/, '');
  return String(picos / 1_000_000_000_000n) + (fraction ? '.' + fraction : '');
}
export function assertPopulationMetrics(metrics: CompleteRuntimeMetricsDto, executions: number, records: number) {
  assert.equal(metrics.state, 'ready'); if (metrics.state !== 'ready') throw new Error('Original population metrics are not ready');
  assert.equal(metrics.executions, String(executions)); assert.equal(metrics.observedExecutions, String(executions)); assert.equal(metrics.records, String(records));
  assert.deepEqual(metrics.tokens, expectedTokens(records));
  assert.deepEqual(metrics.cost, { currency: 'CNY', state: 'complete', amount: expectedYuan(records) });
}
function ordinal(id: string, namespace: number, count: number) {
  const n = Number.parseInt(id.slice(-12), 16); assert.ok(Number.isSafeInteger(n) && n >= 0 && n < count); assert.equal(id, populationId(namespace, n)); return n;
}
/** Acceptance-only identity bitmap. It cannot contribute to any production total. */
export function identityBitmap(count: number) {
  const bytes = new Uint8Array(Math.ceil(count / 8)); let received = 0;
  return { add(n: number) { assert.ok(Number.isSafeInteger(n) && n >= 0 && n < count); const offset = Math.floor(n / 8), mask = 1 << (n & 7); assert.equal(bytes[offset]! & mask, 0, 'Duplicate original identity'); bytes[offset] = bytes[offset]! | mask; received++; },
    finish() { assert.equal(received, count, 'Original population is missing identities'); return received; } };
}
type ReadyReport = Extract<RuntimeCompleteReport, { state: 'ready' }>;
function assertReady(report: RuntimeCompleteReport): asserts report is ReadyReport {
  assert.equal(report.state, 'ready', JSON.stringify(report));
}
export function assertPopulationSummary(report: RuntimeCompleteReport, tasks: number, recordsPerTask: number, project: ProjectId | null) {
  assertReady(report); const size = populationDimensions(tasks, recordsPerTask), summary = report.summary;
  assert.equal(report.header.projectId, project); assert.equal(report.header.scope, project === null ? 'system' : 'project'); assert.equal(report.header.coverage, 'complete');
  assert.equal(summary.tasks, String(tasks)); assertPopulationMetrics(summary.metrics, tasks, size.records);
  assert.deepEqual(summary.durations, { state: 'complete', samples: String(tasks), p50Ms: '10000', p95Ms: '10000', maxMs: '10000' });
  assert.equal(summary.sources.find(row => row.kind === 'business-task')?.tasks, String(tasks));
  assert.equal(summary.sources.find(row => row.kind === 'development-agent')?.tasks, '0');
  assert.equal(summary.trend.reduce((sum, row) => sum + BigInt(row.tasks), 0n), BigInt(tasks));
  const active = summary.trend.filter(row => row.tasks !== '0'); assert.equal(active.length, 1); assertPopulationMetrics(active[0]!.metrics, tasks, size.records);
  return report;
}
async function* originalPages(harness: RuntimePopulationHarness, project: ProjectId | null, report: ReadyReport, section: RuntimeReportSection, total: number, parent?: string) {
  let after: string | undefined, received = 0;
  for (;;) {
    const page: RuntimeReportPage<unknown> = await harness.module.api.runtimeCompleteReportPage(actor, project, report.reportId, { section, parent, after, pageSize: 37 });
    assert.equal(page.reportId, report.reportId); assert.equal(page.snapshotId, report.header.snapshotId); assert.equal(page.total, String(total));
    received += page.items.length; yield page;
    if (page.nextCursor === null) { assert.equal(received, total); return; }
    assert.ok(page.items.length > 0); assert.notEqual(page.nextCursor, after); after = page.nextCursor;
  }
}
async function verifyTaskChildren(h: RuntimePopulationHarness, project: ProjectId | null, report: ReadyReport, task: number, recordsPerTask: number, calls: ReturnType<typeof identityBitmap>) {
  for await (const page of originalPages(h, project, report, 'attempts', 1, populationId(10, task))) for (const value of page.items) {
    const attempt = CompleteRuntimeAttemptSummarySchema.parse(value); assert.equal(attempt.id, populationId(11, task)); assert.equal(attempt.executionId, populationId(12, task));
    assert.equal(attempt.taskId, populationId(10, task)); assert.equal(attempt.profileId, profileId); assert.equal(attempt.profileName, originalProfileName); assert.equal(attempt.durationMs, '10000');
    assertPopulationMetrics(attempt.metrics, 1, recordsPerTask);
  }
  for await (const page of originalPages(h, project, report, 'calls', recordsPerTask, populationId(10, task))) for (const value of page.items) {
    const call = CompleteRuntimeCallSchema.parse(value), match = /^record-(0|[1-9]\d*)$/.exec(call.recordId); assert.ok(match);
    const n = Number(match[1]); assert.equal(Math.floor(n / recordsPerTask), task); calls.add(n);
    assert.deepEqual(call.identity, populationIdentity(task)); assert.equal(call.taskId, populationId(10, task)); assert.equal(call.projectId, projectId); assert.equal(call.projectName, originalProjectName);
    assert.equal(call.sourceId, sourceId); assert.equal(call.modelRef, modelRef); assert.equal(call.profileId, profileId); assert.equal(call.profileName, originalProfileName); assert.equal(call.profileRevision, 7);
    assert.deepEqual(call.scope, { root: 'root-' + task, session: 'root-' + task, parentSession: null, ancestors: [], turn: 'turn-' + task, turnIndex: 0, level: 'request' });
    assertPopulationMetrics(call.metrics, 1, 1);
  }
}
async function verifyDimensions(h: RuntimePopulationHarness, project: ProjectId | null, report: ReadyReport, tasks: number, records: number) {
  for await (const page of originalPages(h, project, report, 'projects', 1)) for (const value of page.items) {
    const row = CompleteRuntimeProjectSchema.parse(value); assert.equal(row.projectId, projectId); assert.equal(row.projectName, originalProjectName); assert.equal(row.tasks, String(tasks)); assertPopulationMetrics(row.metrics, tasks, records);
  }
  for await (const page of originalPages(h, project, report, 'profiles', 1)) for (const value of page.items) {
    const row = CompleteRuntimeProfileSchema.parse(value); assert.equal(row.profileId, profileId); assert.equal(row.profileName, originalProfileName); assert.equal(row.tasks, String(tasks)); assertPopulationMetrics(row.metrics, tasks, records);
  }
  for await (const page of originalPages(h, project, report, 'models', 1)) for (const value of page.items) {
    const row = CompleteRuntimeModelSchema.parse(value); assert.equal(row.modelRef, modelRef); assert.equal(row.tasks, String(tasks)); assertPopulationMetrics(row.metrics, tasks, records);
  }
}
export async function qualifyRuntimePopulation(h: RuntimePopulationHarness, project: ProjectId | null, tasks: number, recordsPerTask: number, progress: (phase: string, rows: number) => void = () => {}) {
  const build = await h.build(project), report = assertPopulationSummary(build.report, tasks, recordsPerTask, project), size = populationDimensions(tasks, recordsPerTask);
  const started = performance.now(), taskIds = identityBitmap(tasks), calls = identityBitmap(size.records); let traversed = 0, finalPageAfter: string | undefined;
  for await (const page of originalPages(h, project, report, 'tasks', tasks)) {
    for (const value of page.items) {
      const task = CompleteRuntimeTaskSummarySchema.parse(value), n = ordinal(task.id, 10, tasks); taskIds.add(n);
      assert.equal(task.projectName, originalProjectName); assert.equal(task.projectId, projectId); assert.equal(task.attemptCount, '1'); assertPopulationMetrics(task.metrics, 1, recordsPerTask);
      assert.equal(task.timing.wallMs, '10000'); assert.deepEqual(task.timing.intervals, { state: 'complete', unknown: '0', cumulativeMs: '10000', activeUnionMs: '10000' });
      await verifyTaskChildren(h, project, report, n, recordsPerTask, calls); traversed++;
      if (traversed % 1000 === 0 || traversed === tasks) progress('original-output-eof/' + report.header.scope, traversed);
    }
    if (page.nextCursor !== null) finalPageAfter = page.nextCursor;
  }
  assert.equal(taskIds.finish(), tasks); assert.equal(calls.finish(), size.records); await verifyDimensions(h, project, report, tasks, size.records);
  return { report, buildMs: build.elapsedMs, eofVerificationMs: performance.now() - started, tasks: String(tasks), calls: String(size.records), finalPageAfter };
}
function timings(samples: readonly number[]) { const sorted = [...samples].sort((a, b) => a - b); return { samples: sorted.length, p50Ms: sorted[Math.ceil(sorted.length * .50) - 1]!, p95Ms: sorted[Math.ceil(sorted.length * .95) - 1]!, maxMs: sorted.at(-1)! }; }
export async function qualifyReadyLatency(h: RuntimePopulationHarness, project: ProjectId | null, result: Awaited<ReturnType<typeof qualifyRuntimePopulation>>) {
  const status: number[] = [], first: number[] = [], last: number[] = [];
  for (let n = 0; n < 100; n++) {
    let started = performance.now(); const value = await h.module.api.runtimeCompleteReportStatus(actor, project, result.report.reportId); assert.equal(value.state, 'ready'); status.push(performance.now() - started);
    started = performance.now(); const head = await h.module.api.runtimeCompleteReportPage(actor, project, result.report.reportId, { section: 'tasks', pageSize: 37 }); first.push(performance.now() - started); assert.equal(head.total, result.tasks);
    started = performance.now(); const tail = await h.module.api.runtimeCompleteReportPage(actor, project, result.report.reportId, { section: 'tasks', pageSize: 37, after: result.finalPageAfter }); last.push(performance.now() - started); assert.equal(tail.nextCursor, null); assert.ok(tail.items.length > 0);
  }
  const measured = { status: timings(status), first: timings(first), last: timings(last) };
  for (const receipt of Object.values(measured)) assert.ok(receipt.p95Ms < 500, 'Original ready page P95 must remain below 500 ms: ' + JSON.stringify(measured));
  return measured;
}
