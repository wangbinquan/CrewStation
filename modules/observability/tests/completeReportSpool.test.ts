import {afterEach,describe,test,expect} from 'bun:test';
import {mkdtempSync,readFileSync,writeFileSync,unlinkSync,existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {jsonHash,newResourceId} from '@crewstation/kernel';
import {RuntimeReportHeaderSchema,RuntimeCompleteSummarySchema} from '@crewstation/contracts';
import {completeRuntimeFileSpool} from '../adapters/persistence/reports/fileSpool';
import type {CompleteReportTransferItem,CompleteReportManifest} from '../ports/completeRuntimeReportCache';
const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture() {
 const root=mkdtempSync(join(tmpdir(),'cs-complete-report-'));roots.push(root);const reportId=newResourceId(),buildOwner='process/'+newResourceId();
 const metrics={state:'ready',tokens:{input:'1201',cacheRead:'3603',cacheWrite:'6005',output:'8407',total:'19216'},executions:'1201',observedExecutions:'1201',records:'1201',cost:{currency:'CNY',state:'complete',amount:'0.0882735'}};
 const header=RuntimeReportHeaderSchema.parse({reportId,projectionVersion:2,scope:'system',projectId:null,filters:{from:'2026-10-03T00:00:00.000Z',to:'2026-10-04T00:00:00.000Z',timezone:'Asia/Shanghai'},asOf:'2026-10-04T00:00:00.000Z',snapshotId:'original-pg-snapshot',generation:'12345',sourceRevision:'20001',coverage:'complete',buildMs:1});
 const summary=RuntimeCompleteSummarySchema.parse({tasks:'1201',metrics,durations:{state:'complete',samples:'0',p50Ms:null,p95Ms:null,maxMs:null},trend:[],sources:[]});
 const identity={reportId,buildOwner,requestKey:'original-request',generation:header.generation,sourceRevision:header.sourceRevision,header,summary,sourceHeaders:[]};
 const items=async function*():AsyncGenerator<CompleteReportTransferItem>{for(let n=0;n<1201;n++)yield {kind:'row',row:{section:'tasks',parent:null,key:String(n),document:{original:n}}};yield {kind:'count',section:'tasks',parent:null,total:'1201'};for(let n=0;n<1201;n++)yield {kind:'receipt',key:String(n),document:{eof:true,rows:'1'}};};
 return {root,identity,items,spool:completeRuntimeFileSpool(root),folder:join(root,'runtime-reports',reportId,jsonHash(buildOwner))};
}
async function consume(f:ReturnType<typeof fixture>,manifest:CompleteReportManifest){let rows=0,receipts=0;for await(const page of f.spool.pages(manifest)){for(const item of page.items){if(item.kind==='row')rows++;if(item.kind==='receipt')receipts++;}}return {rows,receipts};}
describe('sealed complete report transport',()=>{
 test('every row and EOF receipt survives bounded pages; another build has separate files',async()=>{
  const f=fixture(),manifest=await f.spool.seal(f.identity,f.items());expect(manifest.pages).toBe('5');expect(await consume(f,manifest)).toEqual({rows:1201,receipts:1201});
  const another=await f.spool.seal({...f.identity,buildOwner:'replacement/'+newResourceId()},f.items());
  await f.spool.remove(manifest.reportId,manifest.buildOwner);expect(existsSync(f.folder)).toBe(false);expect(await consume(f,another)).toEqual({rows:1201,receipts:1201});
 });
 test('losing one middle page cannot produce a complete population',async()=>{
  const f=fixture(),manifest=await f.spool.seal(f.identity,f.items());unlinkSync(join(f.folder,'2.json'));await expect(consume(f,manifest)).rejects.toThrow();
 });
 test('tampering one original row or the final population is detected before completion',async()=>{
  const f=fixture(),manifest=await f.spool.seal(f.identity,f.items()),path=join(f.folder,'1.json'),page=JSON.parse(readFileSync(path,'utf8'));
  page.items[0].row.document.original=999999;writeFileSync(path,JSON.stringify(page));await expect(consume(f,manifest)).rejects.toThrow('digest changed');
 });
 test('cancellation leaves no sealed complete manifest and cleanup only removes its own build',async()=>{
  const f=fixture(),abort=new AbortController(),items=async function*(){for await(const item of f.items()){yield item;abort.abort(new Error('cancelled original report'));}};
  await expect(f.spool.seal(f.identity,items(),abort.signal)).rejects.toThrow('cancelled original report');expect(existsSync(join(f.folder,'sealed.json'))).toBe(false);
  await f.spool.remove(f.identity.reportId,f.identity.buildOwner);expect(existsSync(f.folder)).toBe(false);
 });
});
