// A single incomplete Task previously masked complete siblings and their project fee settings.
import {afterEach,describe,expect,test} from 'bun:test';
import {sql} from 'drizzle-orm';
import {testDatabaseAvailable} from '@crewstation/testkit';
import {CompleteRuntimeTaskSummarySchema,runtimeCompleteReportContent,type ProjectId,type RuntimeCompleteReport} from '@crewstation/contracts';
import {completeFactsFixture} from './completeFactsFixture';
const available=await testDatabaseAvailable();let fixture:Awaited<ReturnType<typeof completeFactsFixture>>|undefined;
afterEach(async()=>{await fixture?.close();fixture=undefined;});
async function allTasks(f:Awaited<ReturnType<typeof completeFactsFixture>>,projectId:ProjectId|null,report:RuntimeCompleteReport,expected=201) {
 const rows=[];let after:string|undefined;
 do {const page=await f.module.api.runtimeCompleteReportPage(f.actor,projectId,report.reportId,{section:'tasks',pageSize:37,after});expect(page.total).toBe(String(expected));expect(page.snapshotId).toBe(runtimeCompleteReportContent(report)!.header.snapshotId);rows.push(...page.items.map(row=>CompleteRuntimeTaskSummarySchema.parse(row)));after=page.nextCursor??undefined;}while(after!==undefined);
 expect(rows).toHaveLength(expected);expect(new Set(rows.map(row=>row.id))).toEqual(new Set(f.f.tasks.map(row=>row.id)));return rows;
}
function assertUnknown(report:RuntimeCompleteReport,expected=201) {
 const content=runtimeCompleteReportContent(report)!;expect(report.state).toBe('not-ready');expect(content.summary.tasks).toBe(String(expected));
 expect(content.summary.metrics.state).toBe('not-ready');expect(content.summary.metrics).not.toHaveProperty('tokens');expect(content.summary.metrics).not.toHaveProperty('cost');
 for(const row of [...content.summary.trend,...content.summary.sources]){expect(row.metrics.state).toBe(row.tasks==='0'?'not-applicable':'not-ready');expect(row.metrics).not.toHaveProperty('tokens');expect(row.metrics).not.toHaveProperty('cost');}
}
describe.skipIf(!available)('independent ordinary Task metrics within sealed whole-report facts',()=>{
 test.each(['system','project'] as const)('%s traverses every original Task and matches the complete sibling lifecycle without summing known subsets',async scope=>{
  const f=fixture=await completeFactsFixture({completeSibling:true}),projectId=scope==='system'?null:f.f.tasks[0]!.projectId,report=await f.settle(projectId);assertUnknown(report);
  const rows=await allTasks(f,projectId,report),missing=rows.find(row=>row.id===f.f.tasks[0]!.id)!,complete=rows.find(row=>row.id===f.sibling!.task.id)!;
  expect(missing.metrics.state).toBe('not-ready');expect(missing.metrics).not.toHaveProperty('tokens');expect(complete.metrics).toMatchObject({state:'ready',tokens:{input:'3',cacheRead:'9',cacheWrite:'15',output:'21',total:'48'},executions:'1',observedExecutions:'1',records:'1',cost:{currency:'CNY',state:scope==='system'?'complete':'hidden',amount:scope==='system'?'0.0002235':null}});
  expect(rows.filter(row=>row.metrics.state==='not-applicable')).toHaveLength(199);expect(rows.every(row=>row.projectName==='Original Project Name')).toBe(true);
  const lifecycle=await f.settle(projectId,f.sibling!.task.id);expect(lifecycle.state).toBe('ready');expect(runtimeCompleteReportContent(lifecycle)!.summary.metrics).toEqual(complete.metrics);
  const one=await f.module.api.runtimeCompleteReportPage(f.actor,projectId,lifecycle.reportId,{section:'tasks',pageSize:37});expect(one.total).toBe('1');expect(CompleteRuntimeTaskSummarySchema.parse(one.items[0]).metrics).toEqual(complete.metrics);expect(one.nextCursor).toBeNull();
  const agents:unknown[]=[];let after:string|undefined;do{const page=await f.module.api.runtimeCompleteReportPage(f.actor,projectId,report.reportId,{section:'agents',pageSize:37,after});agents.push(...page.items);after=page.nextCursor??undefined;}while(after!==undefined);expect(agents).toHaveLength(1002);expect(agents.find(row=>(row as {agentId:string}).agentId===f.sibling!.attempt.agentId)).toMatchObject({metrics:complete.metrics});
  for(const section of ['profiles','projects'] as const){const page=await f.module.api.runtimeCompleteReportPage(f.actor,projectId,report.reportId,{section,pageSize:37});for(const row of page.items){const metrics=(row as {metrics:{state:string}}).metrics;expect(metrics.state).toBe('not-ready');expect(metrics).not.toHaveProperty('tokens');expect(metrics).not.toHaveProperty('cost');expect(metrics).toHaveProperty('recordedUsage');}}
 },60000);
 test('project fee hiding revokes an existing visible sibling cost while a new report retains all exact Token bins',async()=>{
  const f=fixture=await completeFactsFixture({completeSibling:true,feePolicyCohort:true}),projectId=f.f.tasks[0]!.projectId;
  await f.module.api.setExecutionCostVisibility(f.actor,projectId,{expectedRevision:0,requestKey:'show-sibling-fees',visibility:'project-members-and-services'});
  const report=await f.settle(projectId);assertUnknown(report,3);const complete=(await allTasks(f,projectId,report,3)).find(row=>row.id===f.sibling!.task.id)!;expect(complete.metrics).toMatchObject({state:'ready',cost:{state:'complete',amount:'0.0002235'}});
  await f.module.api.setExecutionCostVisibility(f.actor,projectId,{expectedRevision:1,requestKey:'hide-sibling-fees',visibility:'hidden'});
  await expect(f.module.api.runtimeCompleteReportStatus(f.actor,projectId,report.reportId)).rejects.toThrow('项目费用显示配置已改变');await expect(f.module.api.runtimeCompleteReportPage(f.actor,projectId,report.reportId,{section:'tasks',pageSize:37})).rejects.toThrow('项目费用显示配置已改变');
  const fresh=await f.settle(projectId);expect(fresh.reportId).not.toBe(report.reportId);assertUnknown(fresh,3);expect((await allTasks(f,projectId,fresh,3)).find(row=>row.id===f.sibling!.task.id)!.metrics).toMatchObject({state:'ready',tokens:{input:'3',cacheRead:'9',cacheWrite:'15',output:'21',total:'48'},cost:{state:'hidden',amount:null}});
 },60000);
 test.each(['wrong-total','unknown-number'] as const)('retained ordinary Task %s cannot expose malformed values from a later response page',async damage=>{
  const f=fixture=await completeFactsFixture({completeSibling:true}),report=await f.settle(null);assertUnknown(report);await allTasks(f,null,report);
  const metrics=damage==='wrong-total'?{state:'ready',tokens:{input:'3',cacheRead:'9',cacheWrite:'15',output:'21',total:'47'},executions:'1',observedExecutions:'1',records:'1',cost:{currency:'CNY',state:'complete',amount:'0.0002235'}}:{state:'not-ready',gaps:['missing'],tokens:{total:'48'}};
  await f.tdb.db.execute(sql`UPDATE observability.runtime_report_rows SET document=jsonb_set(document,'{metrics}',${JSON.stringify(metrics)}::jsonb) WHERE report_id=${report.reportId} AND section='tasks' AND parent='' AND key=${f.sibling!.task.id}`);
  await expect(f.module.api.runtimeCompleteReportPage(f.actor,null,report.reportId,{section:'tasks',rowKey:f.sibling!.task.id,pageSize:37})).rejects.toThrow(damage==='wrong-total'?'child subtotals':'Incomplete usage');
 },60000);
});
