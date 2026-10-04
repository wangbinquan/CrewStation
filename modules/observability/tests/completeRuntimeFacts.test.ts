// A missing native proof may withhold numeric totals, never independently sealed Task/time facts.
import {afterEach,describe,expect,test} from 'bun:test';
import {sql} from 'drizzle-orm';
import {testDatabaseAvailable} from '@crewstation/testkit';
import {CompleteRuntimeTaskSummarySchema,CompleteRuntimeAttemptSummarySchema,RUNTIME_REPORT_FACT_SECTIONS,runtimeCompleteReportContent,type RuntimeReportPage,type RuntimeReportSection} from '@crewstation/contracts';
import {completeFactsFixture} from './completeFactsFixture';
const available=await testDatabaseAvailable();let fixture:Awaited<ReturnType<typeof completeFactsFixture>>|undefined;
afterEach(async()=>{await fixture?.close();fixture=undefined;});
describe.skipIf(!available)('sealed original execution facts',()=>{
 test.each(['system','project'] as const)('%s retains all 201 Tasks and 1001 attempts through EOF with unknown tokens and costs',async scope=>{
  const f=fixture=await completeFactsFixture(),projectId=scope==='system'?null:f.f.tasks[0]!.projectId,report=await f.settle(projectId);
  expect(report.state).toBe('not-ready');if(report.state!=='not-ready'||!report.facts)throw new Error('Original sealed facts missing');
  const content=runtimeCompleteReportContent(report)!;expect(content.header.coverage).toBe('complete-facts');expect(content.summary.tasks).toBe('201');expect(content.summary.metrics.state).toBe('not-ready');expect(content.summary.durations).toEqual({state:'complete',samples:'201',p50Ms:'10000',p95Ms:'10000',maxMs:'10000'});
  for(const value of [content.summary.metrics,...content.summary.trend.map(row=>row.metrics),...content.summary.sources.map(row=>row.metrics)]){expect(value.state).toBe('not-ready');expect(value).not.toHaveProperty('tokens');expect(value).not.toHaveProperty('cost');}
  async function all(section:RuntimeReportSection,parent?:string) {
   const rows:unknown[]=[];let after:string|undefined;
   do {const page:RuntimeReportPage<unknown>=await f.module.api.runtimeCompleteReportPage(f.actor,projectId,report.reportId,{section,parent,pageSize:37,after});expect(page.reportId).toBe(report.reportId);expect(page.snapshotId).toBe(content.header.snapshotId);rows.push(...page.items);after=page.nextCursor??undefined;}while(after!==undefined);
   return rows;
  }
  const tasks=(await all('tasks')).map(row=>CompleteRuntimeTaskSummarySchema.parse(row));expect(tasks).toHaveLength(201);expect(new Set(tasks.map(row=>row.id))).toEqual(new Set(f.f.tasks.map(row=>row.id)));expect(tasks.every(row=>row.projectName==='Original Project Name')).toBe(true);expect(tasks.find(row=>row.id===f.f.tasks[0]!.id)!.metrics.state).toBe('not-ready');expect(tasks.filter(row=>row.metrics.state==='not-applicable')).toHaveLength(200);
  for(const section of ['attempts','swimlane'] as const){const rows=(await all(section,f.f.tasks[0]!.id)).map(row=>CompleteRuntimeAttemptSummarySchema.parse(row));expect(rows).toHaveLength(1001);expect(new Set(rows.map(row=>row.key)).size).toBe(1001);expect(rows.every(row=>row.profileName==='Original Compute Name'&&row.durationMs==='10000'&&row.metrics.state==='not-ready')).toBe(true);}
  const quality=await all('quality') as {taskId:string;reason:string}[];expect(quality.length).toBeGreaterThan(0);expect(new Set(quality.map(row=>JSON.stringify([row.taskId,row.reason]))).size).toBe(quality.length);for(const row of quality){expect(row.taskId).toBe(f.f.tasks[0]!.id);expect((await all('quality',row.reason)).some(raw=>(raw as {taskId:string}).taskId===row.taskId)).toBe(true);}
  for(const section of ['agents','agent-tasks','profiles','profile-tasks','projects'] as const)expect(RUNTIME_REPORT_FACT_SECTIONS).toContain(section);
  for(const section of ['models','calls','captures'] as const)await expect(f.module.api.runtimeCompleteReportPage(f.actor,projectId,report.reportId,{section,pageSize:37})).rejects.toThrow('不能读取数值明细');
  await f.tdb.db.execute(sql`DELETE FROM observability.runtime_report_rows WHERE report_id=${report.reportId} AND section='tasks' AND key=${f.f.tasks.at(-1)!.id}`);
  await expect(f.module.api.runtimeCompleteReportStatus(f.actor,projectId,report.reportId)).rejects.toThrow('population missing');
  await expect(f.module.api.runtimeCompleteReportPage(f.actor,projectId,report.reportId,{section:'tasks',pageSize:37})).rejects.toThrow('population missing');
 },60000);
 // Independent builds each keep the original 60 second budget; the source rows and assertions are unchanged.
 test.each(['system','project'] as const)('%s Task lifetime facts retain the independently sealed original identity and all attempts',async scope=>{
  const f=fixture=await completeFactsFixture(),projectId=scope==='system'?null:f.f.tasks[0]!.projectId;
  const task=await f.settle(projectId,f.f.tasks[0]!.id);expect(task.state).toBe('not-ready');if(task.state!=='not-ready'||!task.facts)throw new Error('Task facts missing');expect(task.facts.summary.tasks).toBe('1');expect(task.facts.header.taskId).toBe(f.f.tasks[0]!.id);
  let after:string|undefined;const keys:string[]=[];
  do {const page=await f.module.api.runtimeCompleteReportPage(f.actor,projectId,task.reportId,{section:'attempts',parent:f.f.tasks[0]!.id,pageSize:37,after});expect(page.snapshotId).toBe(task.facts.header.snapshotId);expect(page.total).toBe('1001');for(const raw of page.items){const row=CompleteRuntimeAttemptSummarySchema.parse(raw);expect(row.metrics.state).toBe('not-ready');expect(row.profileName).toBe('Original Compute Name');keys.push(row.key);}after=page.nextCursor??undefined;}while(after!==undefined);
  expect(keys).toHaveLength(1001);expect(new Set(keys).size).toBe(1001);
 },60000);
 test('an original Task source failure has neither facts nor any retained child row',async()=>{
  const f=fixture=await completeFactsFixture();f.controls.broken=true;const report=await f.settle(null);
  expect(report).toMatchObject({state:'failed',error:'Original Task source unavailable'});expect(report).not.toHaveProperty('facts');expect(runtimeCompleteReportContent(report)).toBeUndefined();
  const [rows]=await f.tdb.db.execute(sql`SELECT count(*)::text AS total FROM observability.runtime_report_rows WHERE report_id=${report.reportId}`);expect(rows!['total']).toBe('0');
 },60000);
});
