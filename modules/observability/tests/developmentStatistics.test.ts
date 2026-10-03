// Persisted full-report ledger/CNY queries and two-level permissions; no production model acceptance.
import { afterEach, describe, expect, test } from 'bun:test';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { newResourceId } from '@crewstation/kernel';
import { RuntimeTaskFactSchema, type CompleteRuntimeTaskSummary, type CompleteRuntimeAttemptSummary, type CompleteRuntimeProject, type CompleteRuntimeProfile, type CompleteRuntimeModel, type CompleteRuntimeContribution } from '@crewstation/contracts';
import { sql } from 'drizzle-orm';
import { observabilityMigrations } from '../wiring';
import { developmentStatisticsFixture, statisticsWindow } from './developmentStatisticsFixture';
const available = await testDatabaseAvailable(); let tdb: TestDatabase;
let current:Awaited<ReturnType<typeof developmentStatisticsFixture>>|undefined;
afterEach(async () => { await current?.close();current=undefined;await tdb?.drop(); });
async function fixture(shared = false) { tdb = await createTestDatabase([observabilityMigrations]); current=await developmentStatisticsFixture(tdb, shared);return current; }
describe.skipIf(!available)('development runtime statistics persisted complete reports', () => {
  test('two Agents in one workspace and business with same trace remain distinct in every subtotal', async () => {
    const f = await fixture(); for (const [n, value] of ['11','13','5'].entries()) await f.feed(f.facts[n]!, value);
    const report=await f.ready(f.module.api.systemRuntimeStatistics(f.admin,statisticsWindow)),page=report.summary;
    expect(report.header.scope).toBe('system');expect(page.tasks).toBe('3');expect((await f.page(report,'tasks')).length).toBe(3);expect(page.metrics).toMatchObject({state:'ready',tokens:{total:'29'},cost:{state:'complete',amount:'0.000058'}});
    expect(page.sources.map(s=>[s.kind,s.tasks,s.metrics.state==='ready'?s.metrics.tokens.total:null])).toEqual([['business-task','1','5'],['development-agent','2','24']]);
    expect((await f.page(report,'agents')).length).toBe(3);const projects=await f.page<CompleteRuntimeProject>(report,'projects');expect(projects[0]?.projectName).toBe('Named project');expect(projects[0]?.metrics).toMatchObject({state:'ready',tokens:{total:'29'}});expect(page.durations).toMatchObject({state:'complete',samples:'1'});
    const profiles=await f.page<CompleteRuntimeProfile>(report,'profiles');expect(profiles.map(p=>p.profileName)).toContain('Accepted Compute A');expect(profiles.map(p=>p.profileName)).toContain('Accepted Compute B');
    expect(page.sources[1]?.collectionState).toBe('production-disabled');expect(page.trend.reduce((n,r)=>n+BigInt(r.metrics.state==='ready'?r.metrics.tokens.total:'0'),0n)).toBe(29n);expect(f.state.transaction).toBe(true);
    const dev=await f.ready(f.module.api.systemRuntimeStatistics(f.admin,{...statisticsWindow,sourceKind:'development-agent'}));expect(dev.summary.metrics).toMatchObject({state:'ready',tokens:{total:'24'}});expect(dev.summary.durations).toMatchObject({state:'complete',samples:'0'});expect((await f.page<CompleteRuntimeModel>(dev,'models'))[0]?.metrics).toMatchObject({state:'ready',tokens:{total:'24'}});
    const detail=await f.ready(f.module.api.systemRuntimeTask(f.admin,f.facts[0]!.id)),task=(await f.page<CompleteRuntimeTaskSummary>(detail,'tasks'))[0]!,attempts=await f.page<CompleteRuntimeAttemptSummary>(detail,'attempts',task.id);expect(task.metrics).toMatchObject({state:'ready',tokens:{total:'11'}});expect(task.timing.wallMs).toBeNull();expect(attempts[0]?.durationMs).toBeNull();expect(task.timing.intervals.unknown).toBe('1');expect(attempts).toMatchObject([{profileName:'Accepted Compute A',profileRevision:7}]);
  });
  test('one business task preserves every original compute in its complete list and detail pages', async () => {
    const f=await fixture(),original=f.facts[2]!,first=original.attempts[0]!;
    f.facts[2]=RuntimeTaskFactSchema.parse({...original,attempts:[{...first,profileName:'Accepted Business A'},{...first,id:newResourceId(),executionId:newResourceId(),profileId:newResourceId(),profileName:'Accepted Business B',profileRevision:8}]});
    for(const attempt of f.facts[2]!.attempts)await f.feed({...f.facts[2]!,attempts:[attempt]},'0');
    const report=await f.ready(f.module.api.systemRuntimeStatistics(f.admin,{...statisticsWindow,sourceKind:'business-task'}));expect(report.summary.tasks).toBe('1');const page=await f.page<CompleteRuntimeAttemptSummary>(report,'attempts',original.id);expect(page.map(p=>[p.profileName,p.profileRevision]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))).toEqual([['Accepted Business A',7],['Accepted Business B',8]]);
    const detail=await f.ready(f.module.api.systemRuntimeTask(f.admin,original.id)),attempts=await f.page<CompleteRuntimeAttemptSummary>(detail,'attempts',original.id);expect(attempts.map(p=>[p.profileName,p.profileRevision])).toEqual(page.map(p=>[p.profileName,p.profileRevision]));expect(attempts).toHaveLength(2);
  });
  test('same accepted compute aggregates once while preserving per-execution contributions and frozen names', async () => {
    const f=await fixture(true);await f.feed(f.facts[0]!,'9007199254740993');await f.feed(f.facts[1]!,'7');
    const report=await f.ready(f.module.api.systemRuntimeStatistics(f.admin,{...statisticsWindow,sourceKind:'development-agent'})),profiles=await f.page<CompleteRuntimeProfile>(report,'profiles');expect(profiles).toHaveLength(1);expect(profiles[0]?.metrics).toMatchObject({state:'ready',tokens:{total:'9007199254741000'}});expect((await f.page<CompleteRuntimeContribution>(report,'profile-tasks',profiles[0]!.key)).map(x=>x.metrics.state==='ready'?x.metrics.tokens.total:null).sort()).toEqual(['7','9007199254740993']);
    f.state.namesAvailable=false;const detail=await f.ready(f.module.api.systemRuntimeTask(f.admin,f.facts[0]!.id)),attempts=await f.page<CompleteRuntimeAttemptSummary>(detail,'attempts',f.facts[0]!.id);expect(attempts[0]?.profileName).toBe('Accepted Compute A');expect(attempts[0]?.profileRevision).toBe(7);
  });
  test('member and admin project projections obey hidden, visible and revoked fees', async () => {
    const f=await fixture();f.state.selected=[f.facts[0]!.id];await f.feed(f.facts[0]!,'11');const read=(actor=f.admin)=>f.ready(f.module.api.projectRuntimeStatistics(actor,f.projectId,statisticsWindow),actor,f.projectId);
    expect((await read()).summary.metrics).toMatchObject({state:'ready',cost:{state:'hidden',amount:null}});expect((await read(f.member)).summary.sources.every(s=>s.metrics.state!=='ready'||s.metrics.cost.amount===null)).toBe(true);
    await f.module.api.setExecutionCostVisibility(f.admin,f.projectId,{expectedRevision:0,requestKey:'statistics-cost-open',visibility:'project-members-and-services'});expect((await read(f.member)).summary.metrics).toMatchObject({state:'ready',cost:{state:'complete',amount:'0.000022'}});
    await f.module.api.setExecutionCostVisibility(f.admin,f.projectId,{expectedRevision:1,requestKey:'statistics-cost-revoke',visibility:'hidden'});expect((await read()).summary.metrics).toMatchObject({state:'ready',cost:{state:'hidden',amount:null}});
    expect((await f.ready(f.module.api.systemRuntimeStatistics(f.admin,statisticsWindow))).summary.metrics).toMatchObject({state:'ready',cost:{state:'complete',amount:'0.000022'}});
    f.state.authorized=false;await expect(read()).rejects.toMatchObject({kind:'forbidden'});await expect(f.module.api.systemRuntimeStatistics(f.member,statisticsWindow)).rejects.toMatchObject({kind:'forbidden'});
  });
  test('wrong Agent evidence cannot publish any Token or CNY statistics', async () => {
    const f=await fixture();await f.feed(f.facts[0]!,'999',{agentId:newResourceId()},false);
    const report=await f.settle(f.module.api.systemRuntimeTask(f.admin,f.facts[0]!.id));expect(report).toMatchObject({state:'failed',error:'Original native capture admitted attempt missing'});expect('summary' in report).toBe(false);expect('metrics' in report).toBe(false);
  });
  test('20001 unselected workspace siblings never enter the selected complete population', async () => {
    const f=await fixture(),selected=f.facts[0]!,original=await f.feed(selected,'11');f.state.selected=[selected.id];
    await tdb.db.execute(sql`INSERT INTO observability.usage_projections(meter_key,task_key,document)
      SELECT 'unselected-'||n,task_key,jsonb_set(jsonb_set(document,'{identity,executionId}',to_jsonb(${newResourceId()}::text)),'{recordId}',to_jsonb('unselected-'||n))
      FROM observability.usage_projections CROSS JOIN generate_series(1,20001) n WHERE document->'identity'->>'executionId'=${original.identity.executionId}`);
    const report=await f.ready(f.module.api.systemRuntimeStatistics(f.admin,statisticsWindow));expect(report.summary.tasks).toBe('1');expect(report.header.coverage).toBe('complete');expect(report.summary.metrics).toMatchObject({state:'ready',tokens:{total:'11'},cost:{state:'complete',amount:'0.000022'}});const rows=await f.page(report,'calls',selected.id);expect(rows).toHaveLength(1);expect('partial' in report).toBe(false);
  },30_000);
});
