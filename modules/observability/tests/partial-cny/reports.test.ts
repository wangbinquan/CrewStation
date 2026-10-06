// Actual original PostgreSQL ledger/spool and EOF across 137 individually owned attempts.
import {afterEach,expect,test} from 'bun:test';
import {testDatabaseAvailable} from '@crewstation/testkit';
import {jsonHash,newResourceId} from '@crewstation/kernel';
import {RuntimeStatisticsQuerySchema,runtimeCompleteReportContent,type ProjectId,type RuntimeCompleteReport,type RuntimeReportSection,type CompleteRuntimeMetricsDto} from '@crewstation/contracts';
import {completeRuntimeReportCache} from '../../adapters/persistence/reports/reportStore';
import {cnyPicos} from '../../domain/cnyPricing';
import {completeFactsFixture} from '../completeFactsFixture';
import {completeCohortWindow} from '../completeCohortFixture';
const available=await testDatabaseAvailable();let fixture:Awaited<ReturnType<typeof completeFactsFixture>>|undefined;
afterEach(async()=>{await fixture?.close();fixture=undefined;});
const received={state:'not-ready',recordedUsage:{executions:'137',observedExecutions:'137',records:'137',tokens:{input:'9453',cacheRead:null,cacheWrite:'0',output:null,total:'9453'},bucketRecords:{input:'137',cacheRead:'0',cacheWrite:'137',output:'0'}},costCoverage:{records:'137',pricedRecords:'0',partiallyPricedRecords:'137',visibility:'visible'},recordedCost:{currency:'CNY',amount:'0.018906',records:'137',pricedRecords:'0',partiallyPricedRecords:'137'}};
async function all(f:Awaited<ReturnType<typeof completeFactsFixture>>,project:ProjectId|null,report:RuntimeCompleteReport,section:RuntimeReportSection,parent?:string){
 const rows:unknown[]=[];let after:string|undefined,pages=0;do{const page=await f.module.api.runtimeCompleteReportPage(f.actor,project,report.reportId,{section,parent,pageSize:37,after});expect(page.reportId).toBe(report.reportId);rows.push(...page.items);after=page.nextCursor??undefined;pages++;}while(after!==undefined);return {rows,pages};
}
test.skipIf(!available)('system/project and task facts retain every partial allocation, original CNY and all EOF dimensions without double counting',async()=>{
 const f=fixture=await completeFactsFixture({partialCnyCohort:true}),projectId=f.f.tasks[0]!.projectId;
 await f.module.api.setExecutionCostVisibility(f.actor,projectId,{expectedRevision:0,requestKey:'ACCEPTANCE-ONLY-partial-CNY-visible',visibility:'project-members-and-services'});
 for(const project of [null,projectId]){
  const report=await f.settle(project),content=runtimeCompleteReportContent(report)!;expect(report.state).toBe('not-ready');expect(content.summary.tasks).toBe('3');expect(content.summary.metrics).toMatchObject(received);expect(content.summary.metrics).not.toHaveProperty('cost');
  const tasks=await all(f,project,report,'tasks');expect(tasks.rows).toHaveLength(3);expect(tasks.pages).toBe(1);expect(tasks.rows.find(row=>(row as {id:string}).id===f.f.tasks[0]!.id)).toMatchObject({metrics:received});
  const agents=await all(f,project,report,'agents'),profiles=await all(f,project,report,'profiles'),projects=await all(f,project,report,'projects'),attempts=await all(f,project,report,'attempts',f.f.tasks[0]!.id),swimlane=await all(f,project,report,'swimlane',f.f.tasks[0]!.id);
  expect(agents.rows).toHaveLength(137);expect(agents.pages).toBe(4);expect(attempts.rows).toHaveLength(137);expect(attempts.pages).toBe(4);expect(swimlane.rows).toHaveLength(137);expect(profiles.rows).toHaveLength(1);expect(projects.rows).toHaveLength(1);
  for(const dimension of [agents,attempts,swimlane]){const total=dimension.rows.reduce<bigint>((sum,row)=>{const metrics=(row as {metrics:CompleteRuntimeMetricsDto}).metrics;if(metrics.state!=='not-ready'||!metrics.recordedCost)throw new Error('Partial dimension amount lost');expect(metrics.recordedCost.pricedRecords).toBe('0');expect(metrics.recordedCost.partiallyPricedRecords).toBe('1');return sum+cnyPicos(metrics.recordedCost.amount);},0n);expect(total.toString()).toBe('18906000000');}
  for(const row of [...profiles.rows,...projects.rows])expect(row).toMatchObject({metrics:received});
  const agent=agents.rows.at(-1) as {key:string},profile=profiles.rows[0] as {key:string};expect((await all(f,project,report,'agent-tasks',agent.key)).rows).toHaveLength(1);const contributions=await all(f,project,report,'profile-tasks',profile.key);expect(contributions.rows).toHaveLength(1);expect(contributions.rows[0]).toMatchObject({metrics:received});
  expect(content.summary.trend.reduce((sum,row)=>sum+BigInt(row.metrics.state==='not-ready'?row.metrics.recordedUsage?.tokens.input??'0':'0'),0n).toString()).toBe('9453');
  const task=await f.settle(project,f.f.tasks[0]!.id);expect(runtimeCompleteReportContent(task)!.summary.metrics).toMatchObject(received);expect((await f.settle(project)).reportId).toBe(report.reportId);
 }
},60000);
test.skipIf(!available)('the original executionFactsVersion three report is immutable while version four retains known partial CNY at the same source revision',async()=>{
 const f=fixture=await completeFactsFixture({partialCnyCohort:true}),cache=completeRuntimeReportCache(f.tdb.db),identity=await cache.identity(),request={actor:f.actor,projectId:null,filters:RuntimeStatisticsQuerySchema.parse(completeCohortWindow)},owner='partial-legacy/'+newResourceId(),old=await cache.ensure(request,jsonHash({projectionVersion:2,executionFactsVersion:3,identity,request}),owner,newResourceId()),gaps=[{source:'old-known-partial-mask',reason:'native-capture-unobserved'}];
 await cache.unavailable(old.id,owner,gaps);const legacy:RuntimeCompleteReport={reportId:old.id,state:'not-ready',gaps};expect(await f.module.api.runtimeCompleteReportStatus(f.actor,null,old.id)).toEqual(legacy);
 const current=await f.settle(null),facts=runtimeCompleteReportContent(current)!;expect(current.reportId).not.toBe(old.id);expect(facts.header.generation).toBe(identity.generation);expect(facts.header.sourceRevision).toBe(identity.revision);expect(facts.header.projectionVersion).toBe(2);expect(facts.summary.metrics).toMatchObject(received);expect(await f.module.api.runtimeCompleteReportStatus(f.actor,null,old.id)).toEqual(legacy);expect(await cache.identity()).toEqual(identity);expect((await f.settle(null)).reportId).toBe(current.reportId);
},60000);
