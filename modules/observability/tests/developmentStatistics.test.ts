// Persisted ledger/CNY queries and two-level permissions; no production model acceptance.
import { afterEach, describe, expect, test } from 'bun:test';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { newResourceId } from '@crewstation/kernel';
import { RuntimeTaskFactSchema } from '@crewstation/contracts';
import { sql } from 'drizzle-orm';
import { observabilityMigrations } from '../wiring';
import { developmentStatisticsFixture, statisticsWindow } from './developmentStatisticsFixture';
const available = await testDatabaseAvailable(); let tdb: TestDatabase;
afterEach(async () => { await tdb?.drop(); });
async function fixture(shared = false) { tdb = await createTestDatabase([observabilityMigrations]); return developmentStatisticsFixture(tdb, shared); }
describe.skipIf(!available)('development runtime statistics persisted queries', () => {
  test('two Agents in one workspace and business with same trace remain distinct in every subtotal', async () => {
    const f = await fixture(); for (const [n, value] of ['11','13','5'].entries()) await f.feed(f.facts[n]!, value);
    const page = await f.module.api.systemRuntimeStatistics(f.admin, statisticsWindow);
    expect(page.sourceScope).toBe('project-executions'); expect(page.tasks).toHaveLength(3); expect(page.metrics.tokens.total).toBe('29'); expect(page.metrics.cost.amount).toBe('0.000058');
    expect(page.sources?.map((s) => [s.kind,s.objects,s.metrics.tokens.total])).toEqual([['business-task',1,'5'],['development-agent',2,'24']]);
    expect(page.agents).toHaveLength(3); expect(page.projects[0]?.projectName).toBe('Named project'); expect(page.projects[0]?.metrics.tokens.total).toBe('29'); expect(page.durations.samples).toBe(1);
    expect(page.profiles.map((p) => p.profileName)).toContain('Accepted Compute A'); expect(page.profiles.map((p) => p.profileName)).toContain('Accepted Compute B');
    expect(page.sources?.[1]?.collectionState).toBe('production-disabled'); expect(page.trend.reduce((n,r) => n+BigInt(r.metrics.tokens.total),0n)).toBe(29n); expect(f.state.transaction).toBe(true);
    const dev = await f.module.api.systemRuntimeStatistics(f.admin, { ...statisticsWindow, sourceKind: 'development-agent' }); expect(dev.metrics.tokens.total).toBe('24'); expect(dev.durations.samples).toBe(0); expect(dev.models[0]?.metrics.tokens.total).toBe('24');
    const detail = await f.module.api.systemRuntimeTask(f.admin,f.facts[0]!.id); expect(detail.metrics.tokens.total).toBe('11'); expect(detail.wallMs).toBeNull(); expect(detail.attempts[0]?.durationMs).toBeNull(); expect(detail.unknownIntervals).toBe(1); expect(detail.acceptedProfiles).toMatchObject([{profileName:'Accepted Compute A',profileRevision:7}]);
  });
  test('one business task preserves every original compute in its list and detail summary', async () => {
    const f = await fixture(), original = f.facts[2]!, first = original.attempts[0]!;
    f.facts[2] = RuntimeTaskFactSchema.parse({ ...original, attempts: [{ ...first, profileName: 'Accepted Business A' },
      { ...first, id: newResourceId(), executionId: newResourceId(), profileId: newResourceId(), profileName: 'Accepted Business B', profileRevision: 8 }] });
    const page = await f.module.api.systemRuntimeStatistics(f.admin, { ...statisticsWindow, sourceKind: 'business-task' });
    expect(page.tasks).toHaveLength(1); expect(page.tasks[0]?.acceptedProfiles?.map(p => [p.profileName, p.profileRevision])).toEqual([['Accepted Business A', 7], ['Accepted Business B', 8]]);
    const detail = await f.module.api.systemRuntimeTask(f.admin, original.id);
    expect(detail.acceptedProfiles).toEqual(page.tasks[0]?.acceptedProfiles); expect(detail.attempts).toHaveLength(2);
  });
  test('same accepted compute aggregates once while preserving per-execution contributions and frozen names', async () => {
    const f = await fixture(true); await f.feed(f.facts[0]!,'9007199254740993'); await f.feed(f.facts[1]!,'7');
    const page = await f.module.api.systemRuntimeStatistics(f.admin,{ ...statisticsWindow, sourceKind: 'development-agent' }); expect(page.profiles).toHaveLength(1); expect(page.profiles[0]?.metrics.tokens.total).toBe('9007199254741000'); expect(page.profiles[0]?.tasks.map((x) => x.metrics.tokens.total)).toEqual(['9007199254740993','7']);
    f.state.namesAvailable = false; const detail = await f.module.api.systemRuntimeTask(f.admin,f.facts[0]!.id); expect(detail.attempts[0]?.profileName).toBe('Accepted Compute A'); expect(detail.attempts[0]?.profileRevision).toBe(7);
  });
  test('member and admin project projections obey hidden, visible and revoked fees', async () => {
    const f = await fixture(); await f.feed(f.facts[0]!,'11'); const read = (actor = f.admin) => f.module.api.projectRuntimeStatistics(actor,f.facts[0]!.projectId,statisticsWindow);
    expect((await read()).metrics.cost).toMatchObject({ visible:false,amount:null }); expect((await read(f.member)).sources?.every((s) => s.metrics.cost.amount === null)).toBe(true);
    await f.module.api.setExecutionCostVisibility(f.admin,f.facts[0]!.projectId,{ expectedRevision:0,requestKey:'statistics-cost-open',visibility:'project-members-and-services' }); expect((await read(f.member)).metrics.cost.amount).toBe('0.000022');
    await f.module.api.setExecutionCostVisibility(f.admin,f.facts[0]!.projectId,{ expectedRevision:1,requestKey:'statistics-cost-revoke',visibility:'hidden' }); expect((await read()).metrics.cost.amount).toBeNull();
    expect((await f.module.api.systemRuntimeStatistics(f.admin,statisticsWindow)).metrics.cost.amount).toBe('0.000022');
    f.state.authorized=false; await expect(read()).rejects.toMatchObject({ kind:'forbidden' }); await expect(f.module.api.systemRuntimeStatistics(f.member,statisticsWindow)).rejects.toMatchObject({ kind:'forbidden' });
  });
  test('wrong Agent evidence is unknown and cannot enter Token or CNY totals', async () => {
    const f = await fixture(); await f.feed(f.facts[0]!,'999',{ agentId:newResourceId() },false);
    const detail = await f.module.api.systemRuntimeTask(f.admin,f.facts[0]!.id); expect(detail.metrics.tokens.total).toBe('0'); expect(detail.metrics.tokens.hasKnown).toBe(false); expect(detail.metrics.cost.amount).toBeNull(); expect(detail.metrics.reasons).toContain('identity-unmatched'); expect(detail.partial).toBe(true);
  });
  test('unselected workspace siblings do not consume the 20000-record budget or quality', async () => {
    const f = await fixture(), selected = f.facts[0]!; const original = await f.feed(selected,'11'); f.state.selected=[selected.id];
    await tdb.db.execute(sql`INSERT INTO observability.usage_projections(meter_key,task_key,document)
      SELECT 'unselected-'||n,task_key,jsonb_set(jsonb_set(document,'{identity,executionId}',to_jsonb(${newResourceId()}::text)),'{recordId}',to_jsonb('unselected-'||n))
      FROM observability.usage_projections CROSS JOIN generate_series(1,20001) n WHERE document->'identity'->>'executionId'=${original.identity.executionId}`);
    const page=await f.module.api.systemRuntimeStatistics(f.admin,statisticsWindow); expect(page.metrics.tokens.total).toBe('11'); expect(page.metrics.cost.amount).toBe('0.000022'); expect(page.partial).toBe(false); expect(page.metrics.reasons).not.toContain('identity-unmatched');
  },30_000);
});
