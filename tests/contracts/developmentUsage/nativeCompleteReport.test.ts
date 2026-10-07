// Original WAL -> journal -> Session PG -> live consumer -> original immutable complete report.
import {afterEach,describe,expect,test} from 'bun:test';
import {createTestDatabase,testDatabaseAvailable,type TestDatabase} from '../../../packages/testkit';
import {sessionMigrations} from '../../../modules/session/wiring';
import {observabilityMigrations} from '../../../modules/observability/wiring';
import {RuntimeNativePagedCaptureSchema,runtimeCompleteReportContent} from '../../../packages/contracts';
import {nativeReportFixture} from './nativeReportFixture';
const available=await testDatabaseAvailable();let database:TestDatabase;
afterEach(async()=>{await database?.drop();});
const create=async()=>{database=await createTestDatabase([sessionMigrations,observabilityMigrations]);return database;};
async function metadata(f:Awaited<ReturnType<typeof nativeReportFixture>>,reportId:string,projectId:typeof f.task.projectId|null=null) {
 const page=await f.reportModule.api.runtimeCompleteReportPage(f.actor,projectId,reportId,{section:'native-pages',parent:f.attemptKey,pageSize:100});return {...page,items:page.items.map(item=>RuntimeNativePagedCaptureSchema.parse(item))};
}
describe.skipIf(!available)('actual native v2 report qualification and retained partial numbers',()=>{
 test('final actual EOF publishes four buckets/CNY, original metadata and every independent source receipt without a legacy capture',async()=>{
  const f=await nativeReportFixture(await create());try {
   f.populate(3,0);await f.execution.persist('final',1);await f.execution.copySession();
   await f.drainLive();
   const report=await f.settle();expect(report.state).toBe('ready');const content=runtimeCompleteReportContent(report)!;
   expect(content.summary.tasks).toBe('1');expect(content.summary.metrics).toMatchObject({state:'ready',records:'3',tokens:{input:'6',cacheRead:'9',cacheWrite:'15',output:'9',total:'39'},cost:{currency:'CNY',state:'complete',amount:'0.0001335'}});
   const page=await metadata(f,report.reportId);expect(page.total).toBe('1');expect(page.nextCursor).toBeNull();
   expect(page.items[0]).toMatchObject({identity:f.execution.registration.identity,sourceVersion:2,counts:{sessions:'1',parts:'3',steps:'3'},sourceState:'source-eof',baselineState:'complete-birth',visitedSteps:'3',heldSteps:'0',numericEof:true,valuationEof:true,workState:'processed',pathsComplete:true,preparedAt:f.execution.preparation.observedAt,issues:[]});
   expect(page.items[0]).not.toHaveProperty('usage');expect(page.items[0]).not.toHaveProperty('amount');expect(page.items[0]).not.toHaveProperty('metrics');
   const [receipt]=await database.handle.client`SELECT document FROM observability.runtime_report_receipts WHERE report_id=${report.reportId}`;
   expect(receipt!.document.map((r:{rows:string})=>r.rows)).toEqual(['1','3','0','1','3']);expect(receipt!.document.every((r:{eof:boolean})=>r.eof)).toBe(true);
   const hidden=await f.settle(f.task.projectId);expect(runtimeCompleteReportContent(hidden)!.summary.metrics).toMatchObject({state:'ready',cost:{state:'hidden',amount:null}});expect((await metadata(f,hidden.reportId,f.task.projectId)).items).toEqual(page.items);
   await database.handle.client`UPDATE observability.runtime_report_rows SET document=document||'{"amount":"999"}'::jsonb WHERE report_id=${report.reportId} AND section='native-pages'`;
   await expect(metadata(f,report.reportId)).rejects.toThrow();
  }finally{await f.close();}
 },60_000);
 test('unknown output retains actual known buckets and partial CNY; strict metadata stays readable in facts while numeric-only collections remain restricted',async()=>{
  const f=await nativeReportFixture(await create());try {
   f.populate(0,0);f.addStep('unknown-original-output',3,f.root,true);await f.execution.persist('final');await f.execution.copySession();await f.drainLive();
   const report=await f.settle();expect(report.state).toBe('not-ready');const content=runtimeCompleteReportContent(report)!;
   expect(content.header.coverage).toBe('complete-facts');expect(content.summary.metrics).toMatchObject({state:'not-ready',recordedUsage:{records:'1',tokens:{input:'3',cacheRead:'3',cacheWrite:'5',output:null,total:'11'}},recordedCost:{currency:'CNY',amount:'0.0000225',records:'1',pricedRecords:'0',partiallyPricedRecords:'1'}});
   const page=await metadata(f,report.reportId);expect(page.total).toBe('1');expect(page.items[0]!.issues.length).toBeGreaterThan(0);
   for(const section of ['calls','models','captures'] as const)await expect(f.reportModule.api.runtimeCompleteReportPage(f.actor,null,report.reportId,{section,pageSize:100})).rejects.toThrow();
   const item=page.items[0]!;for(const patch of [{counts:{...item.counts,steps:1}},{amount:'1'},{baselineState:'before-only'},{visitedSteps:'2'},{numericEof:true,visitedSteps:'0'}])expect(RuntimeNativePagedCaptureSchema.safeParse({...item,...patch}).success).toBe(false);
  }finally{await f.close();}
 },60_000);
 test('an empty source with unknown root birth never becomes complete zero usage',async()=>{
  const f=await nativeReportFixture(await create());try {
   f.populate(0,0,false);await f.execution.persist('final');await f.execution.copySession();await f.drainLive();
   const report=await f.settle();expect(report.state).toBe('not-ready');const metrics=runtimeCompleteReportContent(report)!.summary.metrics;expect(metrics).not.toHaveProperty('tokens');expect(metrics).not.toHaveProperty('recordedUsage');
   expect((await metadata(f,report.reportId)).items[0]).toMatchObject({counts:{steps:'0'},baselineState:'unknown',issues:['native-root-birth-unproved']});
  }finally{await f.close();}
 },60_000);
 test('pending work after durable ACK remains visible; recovery produces a new complete snapshot, and changed original pass bytes are rejected',async()=>{
  const f=await nativeReportFixture(await create(),{failAfterAck:true});try {
   f.populate(1,0);await f.execution.persist('final');await f.execution.copySession();expect(await f.module.api.reconcileExecutionUsage()).toBe(1);
   const pending=await f.settle();expect(pending.state).toBe('not-ready');expect((await metadata(f,pending.reportId)).items[0]).toMatchObject({workState:'pending',numericEof:false,valuationEof:false,visitedSteps:'0',counts:{steps:'1'}});
   f.allowRecoveredWork();expect(await f.reopen().api.reconcileExecutionUsage()).toBe(1);const complete=await f.settle();expect(complete.reportId).not.toBe(pending.reportId);expect(complete.state).toBe('ready');expect(runtimeCompleteReportContent(complete)!.summary.metrics).toMatchObject({tokens:{input:'1',cacheRead:'3',cacheWrite:'5',output:'3',total:'12'},cost:{amount:'0.0000425'}});
   expect((await metadata(f,pending.reportId)).items[0]!.workState).toBe('pending');
   await database.handle.client`UPDATE observability.development_native_passes SET document=jsonb_set(document,'{preparation,observedAt}','"2020-01-01T00:00:00.000Z"'::jsonb)`;
   expect(await f.settle(null,true)).toMatchObject({state:'failed',retryable:true,error:expect.stringContaining('原生报告 pass 原登记或来源不符')});
  }finally{await f.close();}
 },60_000);
});
