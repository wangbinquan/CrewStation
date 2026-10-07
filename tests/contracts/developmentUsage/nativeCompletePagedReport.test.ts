// Actual WAL -> Session PG -> live consumer -> immutable report across numeric ordinal boundaries.
import {afterEach,describe,expect,test} from 'bun:test';
import {createTestDatabase,testDatabaseAvailable,type TestDatabase} from '../../../packages/testkit';
import {sessionMigrations} from '../../../modules/session/wiring';
import {observabilityMigrations} from '../../../modules/observability/wiring';
import {RuntimeNativePagedCaptureSchema,runtimeCompleteReportContent} from '../../../packages/contracts';
import {nativeReportFixture} from './nativeReportFixture';
const available=await testDatabaseAvailable();let database:TestDatabase;
afterEach(async()=>{await database?.drop();});
describe.skipIf(!available)('actual complete native report pagination without a population cap',()=>{
 test('all 211 original steps and more than 100 original pages reach report EOF with exact four buckets and original CNY pricing',async()=>{
  database=await createTestDatabase([sessionMigrations,observabilityMigrations]);
  const f=await nativeReportFixture(database);try {
   f.populate(211,0);await f.execution.persist('final',1);await f.execution.copySession();await f.drainLive();
   const [original]=await database.handle.client`SELECT count(*)::text AS pages,max(ordinal::numeric)::text AS last FROM observability.development_native_pages`;
   expect(BigInt(original!.pages)).toBeGreaterThan(100n);expect(BigInt(original!.last)+1n).toBe(BigInt(original!.pages));
   expect(await f.session.api.nextDevelopmentUsageSource()).toBeUndefined();
   for(const detail of [false,true]) {
    const report=await f.settle(null,detail);expect(report).toMatchObject({state:'ready'});
    const content=runtimeCompleteReportContent(report)!;
    expect(content.summary.tasks).toBe('1');expect(content.summary.metrics).toMatchObject({state:'ready',records:'211',
     tokens:{input:'22366',cacheRead:'633',cacheWrite:'1055',output:'633',total:'24687'},
     cost:{currency:'CNY',state:'complete',amount:'0.0532775'}});
    const page=await f.reportModule.api.runtimeCompleteReportPage(f.actor,null,report.reportId,{section:'native-pages',parent:f.attemptKey,pageSize:100});
    expect(page.total).toBe('1');expect(page.nextCursor).toBeNull();expect(page.items).toHaveLength(1);
    const item=RuntimeNativePagedCaptureSchema.parse(page.items[0]);
    expect(item).toMatchObject({identity:f.execution.registration.identity,sourceVersion:2,sourceState:'source-eof',workState:'processed',
     counts:{sessions:'1',parts:'211',steps:'211'},pages:original!.pages,cursor:{ordinal:original!.pages,index:0},
     visitedSteps:'211',heldSteps:'0',numericEof:true,valuationEof:true,baselineState:'complete-birth',pathsComplete:true,issues:[]});
    for(const key of ['usage','tokens','amount','metrics'])expect(item).not.toHaveProperty(key);
    const [receipt]=await database.handle.client`SELECT document FROM observability.runtime_report_receipts WHERE report_id=${report.reportId}`;
    expect(receipt!.document.map((r:{rows:string})=>r.rows)).toEqual(['1','211','0','1','211']);
    expect(receipt!.document.every((r:{eof:boolean})=>r.eof)).toBe(true);
   }
  }finally{await f.close();}
 },60_000);
});
