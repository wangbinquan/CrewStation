// Real original PostgreSQL, immutable derived pages and physical generation; no model-dispatch claim.
import {afterEach,describe,test,expect} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {sql} from 'drizzle-orm';
import {RuntimeReportHeaderSchema,RuntimeCompleteSummarySchema,type Actor,type RuntimeReportPage} from '@crewstation/contracts';
import {jsonHash,newResourceId} from '@crewstation/kernel';
import {connectDatabase,originalReportSnapshotSession,type DatabaseHandle} from '@crewstation/persistence';
import {createTestDatabase,testDatabaseAvailable,type TestDatabase} from '@crewstation/testkit';
import {observabilityMigrations} from '../wiring';
import {completeRuntimeReportCache} from '../adapters/persistence/reports/reportStore';
import {completeRuntimeFileSpool} from '../adapters/persistence/reports/fileSpool';
import type {CompleteReportTransferItem,CompleteReportStored} from '../ports/completeRuntimeReportCache';
const available=await testDatabaseAvailable();let tdb:TestDatabase,handle:DatabaseHandle|undefined;const roots:string[]=[];
afterEach(async()=>{await handle?.close();handle=undefined;await tdb?.drop();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
async function fixture() {
 tdb=await createTestDatabase([observabilityMigrations]);handle=connectDatabase(tdb.url,{max:1});const store=completeRuntimeReportCache(handle.db),identity=await store.identity(),reportId=newResourceId(),owner='original/'+newResourceId();
 const root=mkdtempSync(join(tmpdir(),'cs-complete-cache-'));roots.push(root);const spool=completeRuntimeFileSpool(root),filters={from:'2026-10-03T00:00:00.000Z',to:'2026-10-04T00:00:00.000Z',timezone:'Asia/Shanghai'};
 const request={actor:{userId:newResourceId(),isAdmin:true} as Actor,projectId:null,filters},requestKey=jsonHash({identity,request}),report=await store.ensure(request,requestKey,owner,reportId);
 const header=RuntimeReportHeaderSchema.parse({reportId,projectionVersion:2,scope:'system',projectId:null,filters,asOf:filters.to,snapshotId:'original-snapshot',generation:identity.generation,sourceRevision:identity.revision,coverage:'complete',buildMs:0});
 const summary=RuntimeCompleteSummarySchema.parse({tasks:'201',metrics:{state:'ready',tokens:{input:'1001',cacheRead:'3003',cacheWrite:'5005',output:'7007',total:'16016'},executions:'1001',observedExecutions:'1001',records:'1001',cost:{currency:'CNY',state:'complete',amount:'0.0735735'}},durations:{state:'complete',samples:'201',p50Ms:'10000',p95Ms:'10000',maxMs:'10000'},trend:[],sources:[]});
 const items=async function*():AsyncGenerator<CompleteReportTransferItem>{for(let n=0;n<201;n++)yield {kind:'row',row:{section:'tasks',parent:null,key:'task-'+n,document:{n}}};for(let n=0;n<1001;n++)yield {kind:'row',row:{section:'calls',parent:'task-0',key:'call-'+n,document:{n}}};yield {kind:'count',section:'tasks',parent:null,total:'201'};yield {kind:'count',section:'calls',parent:'task-0',total:'1001'};for(let n=0;n<201;n++)yield {kind:'receipt',key:'task-'+n,document:{eof:true,rows:'1'}};};
 const manifest=await originalReportSnapshotSession(handle).run(async snapshot=>spool.seal({reportId,buildOwner:owner,requestKey,generation:identity.generation,sourceRevision:identity.revision,header:{...header,snapshotId:snapshot.snapshotId,asOf:snapshot.asOf},summary,sourceHeaders:[]},items()));
 return {store,spool,report,manifest,owner,reportId};
}
async function all(f:Awaited<ReturnType<typeof fixture>>,report:CompleteReportStored,section:'tasks'|'calls',parent?:string){const items:unknown[]=[];let after:string|null=null;do{const page:RuntimeReportPage<{n:number}>=await f.store.page<{n:number}>(report,{section,parent,pageSize:37},after);expect(page.total).toBe(section==='tasks'?'201':'1001');items.push(...page.items);after=page.nextCursor;}while(after!==null);return items;}
describe.skipIf(!available)('original complete report cache',()=>{
 test('pool max=1 closes original input before staging; 201 tasks and 1001 calls page to true EOF',async()=>{
  const f=await fixture();await expect(f.store.page(f.report,{section:'tasks',pageSize:37},null)).rejects.toThrow('not ready');
  for await(const page of f.spool.pages(f.manifest))await f.store.stage(f.reportId,f.owner,page);
  await f.store.publish(f.reportId,f.owner,f.manifest);const ready=(await f.store.get(f.reportId))!;expect(ready.report.state).toBe('ready');
  expect(await all(f,ready,'tasks')).toEqual(Array.from({length:201},(_,n)=>({n})));expect(await all(f,ready,'calls','task-0')).toEqual(Array.from({length:1001},(_,n)=>({n})));
  if(ready.report.state==='ready')expect(ready.report.summary.metrics).toEqual(f.manifest.summary.metrics);
  const [physical]=await handle!.db.execute(sql`SELECT (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS generation`);expect(f.manifest.generation).toBe(String(physical!['generation']));
 },60000);
 test('one missing final staging page blocks readiness without any partial statistics',async()=>{
  const f=await fixture();for await(const page of f.spool.pages(f.manifest))if(BigInt(page.ordinal)+1n<BigInt(f.manifest.pages))await f.store.stage(f.reportId,f.owner,page);
  await expect(f.store.publish(f.reportId,f.owner,f.manifest)).rejects.toThrow('population missing');const report=(await f.store.get(f.reportId))!;expect(report.report).toMatchObject({state:'building'});expect('summary' in report.report).toBe(false);
 },60000);
 test('renewed ownership survives another worker; expired recovery fences old staging and keeps full counts',async()=>{
  const f=await fixture(),replacement='replacement/'+newResourceId();expect(await f.store.renew(f.reportId,f.owner)).toBe(true);expect((await f.store.claim(f.reportId,replacement)).owner).toBe(f.owner);
  await handle!.db.execute(sql`UPDATE observability.runtime_reports SET lease_until=clock_timestamp()-interval '1 second' WHERE id=${f.reportId}`);const recovered=await f.store.claim(f.reportId,replacement);expect(recovered.owner).toBe(replacement);
  const first=await f.spool.pages(f.manifest)[Symbol.asyncIterator]().next();await expect(f.store.stage(f.reportId,f.owner,first.value!)).rejects.toThrow('ownership changed');expect(await f.store.renew(f.reportId,f.owner)).toBe(false);
  const manifest=await f.spool.seal({...f.manifest,buildOwner:replacement},(async function*(){for await(const page of f.spool.pages(f.manifest))yield* page.items;})());
  for await(const page of f.spool.pages(manifest))await f.store.stage(f.reportId,replacement,page);await f.store.publish(f.reportId,replacement,manifest);const ready=(await f.store.get(f.reportId))!;expect(await all(f,ready,'tasks')).toHaveLength(201);expect(await all(f,ready,'calls','task-0')).toHaveLength(1001);
 },60000);
});
