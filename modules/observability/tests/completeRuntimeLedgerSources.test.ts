import { completeExternalSort } from '../application/completeExternalSort';
// RFC-034: every original row past the old task/record/capture boundaries must reach EOF.
import { afterEach, describe, expect, test } from 'bun:test';
import { ExecutionObservationIdentitySchema, NativeUsageProofSchema, RuntimeTaskHeaderFactSchema, UsageValuationSchema, type UsageExecutionIdentity, type UsageRecord } from '@crewstation/contracts';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import type { ReportWorkingPage } from '@crewstation/persistence';
import { originalReportSnapshotSession } from '@crewstation/persistence';
import { completeUsageWorkspace } from '../adapters/persistence/completeUsageWorkspace';
import { runtimeContributionEvidence } from '../domain/completeUsageEvidence';
import { selectCompleteUsage } from '../application/completeUsageSelection';
import { observabilityMigrations } from '../wiring';
import { completeRuntimeLedgerSources } from '../adapters/persistence/completeRuntimeLedgerSources';
import { usageProjections, executionValuations, nativeCaptures, usageHeads, costVisibility } from '../adapters/persistence/tables';
import { nativeCaptureSummary, rebuildUsageProjection, type NativeCaptureDocument } from '../domain/usageProjection';
import { runtimeLedgerScope } from '../domain/runtimeIdentity';
import type { CompleteSourceReader } from '../ports/completeReport';
const available = await testDatabaseAvailable();
let tdb: TestDatabase;
afterEach(async () => { await tdb?.drop(); });
const at = '2026-10-03T00:00:00.000Z';
function fixtureIdentity() {
  return ExecutionObservationIdentitySchema.parse({ projectId: newResourceId(), taskId: newResourceId(), subtaskId: newResourceId(), executionId: newResourceId(), executionGeneration: 1 });
}
function header(identity: UsageExecutionIdentity) {
  const development = 'sourceKind' in identity;
  return RuntimeTaskHeaderFactSchema.parse({ id: development ? identity.executionId : identity.taskId, projectId: identity.projectId, serviceId: newResourceId(), name: 'Original complete cohort', protocol: development ? 'development' : 'v3', state: 'closed', traceId: null, createdAt: at, closedAt: null,
    source: development ? { kind: 'development-agent', identity, workspaceName: null } : { kind: 'business-task' } });
}
function usage(identity: UsageExecutionIdentity, n: number): UsageRecord {
  return rebuildUsageProjection([{ kind: 'usage', identity, sourceId: 'original-runner', recordId: 'record-'+n, revision: 1, occurredAt: at, observedAt: at, adapterVersion: 'fixture/original', modelRef: null, reporting: 'delta', inclusion: 'self', coverage: 'complete', validity: 'valid', scope: null, coveredThroughTurn: null, basis: { kind: 'invocation' }, usage: { input: String(n+1), cacheRead: '3', cacheWrite: '5', output: '7' } }]);
}
const picos = (n: number) => BigInt(n+1)*2_000_000n + 3n*500_000n + 5n*3_000_000n + 7n*8_000_000n;
const decimal = (value: bigint) => `${value/1_000_000_000_000n}.${String(value%1_000_000_000_000n).padStart(12,'0')}`;
const parsePicos = (value: string) => { const [whole, fraction = ''] = value.split('.'); return BigInt(whole!)*1_000_000_000_000n + BigInt(fraction.padEnd(12,'0')); };
async function insertUsage(identity: UsageExecutionIdentity, count: number) {
  const taskKey = jsonHash({ projectId: identity.projectId, taskId: identity.taskId });
  for (let offset=0; offset<count; offset+=100) {
    const records = Array.from({ length: Math.min(100,count-offset) }, (_,i) => usage(identity,offset+i));
    const meterKey = (r: UsageRecord) => jsonHash({ identity: r.identity, sourceId: r.sourceId, recordId: r.recordId });
    await tdb.db.insert(usageProjections).values(records.map((document) => ({ meterKey: meterKey(document), taskKey, document })));
    await tdb.db.insert(executionValuations).values(records.map((r,i) => ({ meterKey: meterKey(r), taskKey, basisFingerprint: jsonHash(r), document: UsageValuationSchema.parse({ kind: 'valuation', identity, sourceId: r.sourceId, recordId: r.recordId, revision: 1, occurredAt: at, observedAt: at, valuationId: 'value-'+(offset+i), valuationRevision: 1, usageRevision: r.projection.projectionRevision, currency: 'CNY', completeness: 'complete', availability: 'priced', priceVersionRef: 'acceptance-only-CNY', amountDecimal: decimal(picos(offset+i)) }) })));
  }
}
async function insertCaptures(identity: UsageExecutionIdentity, count: number) {
  const taskKey = jsonHash({ projectId: identity.projectId, taskId: identity.taskId });
  for (let offset=0; offset<count; offset+=100) {
    const documents: NativeCaptureDocument[] = Array.from({ length: Math.min(100,count-offset) }, (_,i) => {
      const turn = 'turn-'+(offset+i);
      return { id: jsonHash(identity)+':capture-'+String(offset+i).padStart(6,'0'), identity, sourceId: 'original-runner', began: true, baselineRoot: 'root', historicalRevisionGap: false,
        proof: NativeUsageProofSchema.parse({ contract: 'opencode-child-steps-v1', lineageKey: 'original-lineage', turn, turnIndex: offset+i, state: 'complete', root: 'root', observedAt: at, baseline: { kind: 'fresh', fingerprint: null }, fingerprint: jsonHash([identity,turn]), sessions: 1, steps: 0, emitted: 0, baselineSteps: 0, priorRevisionGap: false, issues: [] }) };
    });
    await tdb.db.insert(nativeCaptures).values(documents.map((document) => ({ id: document.id, taskKey, sourceId: document.sourceId, turn: document.proof.turn, lineageKey: document.proof.lineageKey, root: document.proof.root, finalized: true, document, summary: nativeCaptureSummary(document,{ steps: 0, baselines: 0, unresolved: 0, revised: 0 }) })));
  }
}
async function all<T>(reader: CompleteSourceReader<T>, snapshotId: string) {
  const result: T[] = [], cursors = new Set<string>(); let cursor: string|null = null;
  for (;;) {
    const page = await reader.next(cursor); expect(page.snapshotId).toBe(snapshotId);
    result.push(...page.items);
    if (page.nextCursor === null) return result;
    expect(page.items.length).toBeGreaterThan(0); expect(cursors.has(page.nextCursor)).toBe(false);
    cursors.add(page.nextCursor); cursor = page.nextCursor;
  }
}
describe.skipIf(!available)('RFC-034 complete original usage/value/capture paging', () => {
  test('10001 usage + 10001 CNY valuations and 2001 capture headers have independent EOF and exact four-bin totals', async () => {
    tdb = await createTestDatabase([observabilityMigrations]); const identity = fixtureIdentity(), task = header(identity), count = 10001;
    await insertUsage(identity,count); await insertCaptures(identity,2001);
    const taskKey = jsonHash(runtimeLedgerScope(task));
    await tdb.db.insert(usageHeads).values({ taskKey, projectId: identity.projectId, taskId: identity.taskId, sequence: 22003 });
    await tdb.db.insert(costVisibility).values({ projectId: identity.projectId, revision: 1, document: { projectId: identity.projectId, revision: 1, visibility: 'project-members-and-services', updatedAt: at } });
    await originalReportSnapshotSession(tdb.handle).run(async (snapshot) => {
      const tx = snapshot.executor;
      const source = completeRuntimeLedgerSources(tx,task,snapshot.snapshotId,137);
      const records = await all(source.usage,source.snapshotId), values = await all(source.valuations,source.snapshotId), captures = await all(source.captures,source.snapshotId);
      const rawUsage = await tx.execute(sql`SELECT document->>'recordId' AS id FROM observability.usage_projections WHERE task_key=${taskKey} ORDER BY meter_key`);
      const rawValues = await tx.execute(sql`SELECT document->>'recordId' AS id FROM observability.execution_valuations WHERE task_key=${taskKey} ORDER BY meter_key`);
      const rawCaptures = await tx.execute(sql`SELECT id FROM observability.native_captures WHERE task_key=${taskKey} ORDER BY id`);
      expect(records.map((r) => r.recordId)).toEqual(rawUsage.map((r) => { expect(typeof r['id']).toBe('string'); return r['id'] as string; })); expect(values.map((r) => r.recordId)).toEqual(rawValues.map((r) => { expect(typeof r['id']).toBe('string'); return r['id'] as string; })); expect(captures.map((r) => r.id)).toEqual(rawCaptures.map((r) => { expect(typeof r['id']).toBe('string'); return r['id'] as string; }));
      const workspace = completeUsageWorkspace({order:completeExternalSort,rows:snapshot.workspace,namespace:'original-usage',keyOf:jsonHash,identity:(r:ReturnType<typeof runtimeContributionEvidence>) => jsonHash([r.sourceId,r.measurement.invocationId,r.measurement.recordId])});
      let after:string|null = null, retained = 0n;
      for (;;) { const page = await source.usage.next(after); await workspace.append(page.items.map(runtimeContributionEvidence)); retained += BigInt(page.items.length); if (page.nextCursor === null) break; after = page.nextCursor; }
      workspace.seal(String(retained)); const selected = await selectCompleteUsage(workspace.workspace); await workspace.flush();
      const allocated:string[] = []; let allocationAfter:string|null = null;
      for (;;) {
        const page:ReportWorkingPage<{record:ReturnType<typeof runtimeContributionEvidence>;contribution:UsageRecord['usage']}> = await snapshot.workspace.page<{record:ReturnType<typeof runtimeContributionEvidence>;contribution:UsageRecord['usage']}>(workspace.allocationsNamespace,allocationAfter,137);
        for (const row of page.items) { allocated.push(row.document.record.original.recordId); expect(row.document.contribution).toEqual(row.document.record.original.projection.contribution); }
        if (page.nextCursor === null) break; allocationAfter = page.nextCursor;
      }
      expect(allocated.sort()).toEqual(records.map((r) => r.recordId).sort()); expect(selected.selected).toBe(String(count));
      expect(selected.tokens).toEqual({input:String(BigInt(count)*BigInt(count+1)/2n),cacheRead:String(3n*BigInt(count)),cacheWrite:String(5n*BigInt(count)),output:String(7n*BigInt(count))});
      expect(records).toHaveLength(count); expect(values).toHaveLength(count); expect(captures).toHaveLength(2001);
      for (const [bucket,expected] of Object.entries({ input: BigInt(count)*BigInt(count+1)/2n, cacheRead: 3n*BigInt(count), cacheWrite: 5n*BigInt(count), output: 7n*BigInt(count) })) expect(records.reduce((sum,r) => sum+BigInt(r.projection.contribution[bucket as keyof UsageRecord['usage']]!),0n)).toBe(expected);
      expect(values.reduce((sum,v) => sum+parsePicos(v.amountDecimal!),0n)).toBe(BigInt(count)*BigInt(count+1)/2n*2_000_000n + BigInt(count)*(3n*500_000n+5n*3_000_000n+7n*8_000_000n));
      expect(await source.costVisible()).toBe(true); expect(await source.persistedThrough()).toBe('22003');
      const first = await source.usage.next(null); expect(first.nextCursor).not.toBeNull();
      await expect(completeRuntimeLedgerSources(tx,task,'other-snapshot').usage.next(first.nextCursor)).rejects.toThrow();
      await expect(completeRuntimeLedgerSources(tx,header(fixtureIdentity()),source.snapshotId).usage.next(first.nextCursor)).rejects.toThrow();
      await expect(source.valuations.next(first.nextCursor)).rejects.toThrow();
    });
  },60000);
  test('original development parent scope excludes sibling executions, retains wrong-Agent evidence and separates business usage', async () => {
    tdb = await createTestDatabase([observabilityMigrations]); const business = fixtureIdentity();
    const identity = { sourceKind: 'development-agent' as const, projectId: business.projectId, taskId: business.taskId, agentId: newResourceId(), executionId: newResourceId(), executionGeneration: 1 };
    await insertUsage(identity,2); await insertUsage({ ...identity, agentId: newResourceId() },1); await insertUsage({ ...identity, executionId: newResourceId() },1); await insertUsage(business,1);
    await insertCaptures(identity,2); await insertCaptures({ ...identity, executionId: newResourceId() },1); await insertCaptures(business,1);
    await tdb.db.transaction(async (tx) => {
      await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`);
      const selected = completeRuntimeLedgerSources(tx,header(identity),'same-original',1), actualBusiness = completeRuntimeLedgerSources(tx,header(business),'same-original',1);
      expect(await all(selected.usage,selected.snapshotId)).toHaveLength(3); expect(await all(selected.valuations,selected.snapshotId)).toHaveLength(3); expect(await all(selected.captures,selected.snapshotId)).toHaveLength(2);
      expect(await all(actualBusiness.usage,actualBusiness.snapshotId)).toHaveLength(1); expect(await all(actualBusiness.captures,actualBusiness.snapshotId)).toHaveLength(1);
      expect(await selected.costVisible()).toBe(false); expect(await selected.persistedThrough()).toBe('0');
    });
    for (const size of [0,501,1.5]) expect(() => completeRuntimeLedgerSources(tdb.db,header(identity),'same-original',size)).toThrow();
    expect(() => completeRuntimeLedgerSources(tdb.db,header(identity),'')).toThrow();
  });
});
