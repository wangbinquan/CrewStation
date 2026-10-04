// A real original PG/TEMP integration. Owner facts are explicit port fixtures, not real model execution acceptance.
import {afterEach,describe,expect,test} from 'bun:test';
import {ExecutionObservationIdentitySchema,NativeUsageProofSchema,RuntimeAttemptFactSchema,RuntimeTaskHeaderFactSchema,UsageValuationSchema,type UsageRecord} from '@crewstation/contracts';
import {jsonHash,newResourceId} from '@crewstation/kernel';
import {createTestDatabase,testDatabaseAvailable,type TestDatabase} from '@crewstation/testkit';
import {originalReportSnapshotSession} from '@crewstation/persistence';
import {buildCompleteRuntimeTask} from '../application/completeRuntimeTask';
import {completeStatisticsWorkspace,observabilityMigrations} from '../wiring';
import {completeRuntimeLedgerSources} from '../adapters/persistence/completeRuntimeLedgerSources';
import {usageProjections,executionValuations,nativeCaptures,nativeSteps,costVisibility} from '../adapters/persistence/tables';
import {nativeCaptureSummary,rebuildUsageProjection,type NativeCaptureDocument} from '../domain/usageProjection';
import {completeWorkingTraversal} from '../application/completeWorkingTraversal';
import type {CompleteRuntimeAllocation} from '../ports/completeRuntimeTask';
const available=await testDatabaseAvailable();let tdb:TestDatabase;
afterEach(async()=>{await tdb?.drop();});
const at='2026-10-03T00:00:00.000Z';
function fixture() {
  const identity=ExecutionObservationIdentitySchema.parse({projectId:newResourceId(),taskId:newResourceId(),subtaskId:newResourceId(),executionId:newResourceId(),executionGeneration:1});
  const task=RuntimeTaskHeaderFactSchema.parse({source:{kind:'business-task'},id:identity.taskId,projectId:identity.projectId,serviceId:newResourceId(),projectName:'Original project fixture',name:'Complete original PG usage fixture',protocol:'v3',state:'closed',createdAt:at,closedAt:'2026-10-03T00:00:10.000Z',traceId:null});
  const attempt=RuntimeAttemptFactSchema.parse({id:identity.subtaskId,taskId:identity.taskId,name:'Owner port fixture',kind:'agent',state:'succeeded',attempt:1,executionId:identity.executionId,agentId:newResourceId(),profileId:newResourceId(),profileName:'Acceptance only CNY',profileRevision:3,createdAt:at,startedAt:at,endedAt:'2026-10-03T00:00:10.000Z'});
  return {identity,task,attempt,taskKey:jsonHash({projectId:identity.projectId,taskId:identity.taskId})};
}
function record(f:ReturnType<typeof fixture>,n:number):UsageRecord {
  return rebuildUsageProjection([{kind:'usage',identity:f.identity,sourceId:'original-runner',recordId:'record-'+n,revision:1,occurredAt:at,observedAt:at,adapterVersion:'original-pg-fixture',modelRef:'fixture-model',reporting:'delta',inclusion:'self',coverage:'complete',validity:'valid',scope:{root:'root',session:'root',parentSession:null,ancestors:[],turn:'turn-'+n,turnIndex:n,level:'request'},coveredThroughTurn:null,basis:{kind:'invocation'},usage:{input:String(n+1),cacheRead:'3',cacheWrite:'5',output:'7'}}]);
}
const pico=(n:number)=>BigInt(n+1)*2_000_000n+3n*500_000n+5n*3_000_000n+7n*8_000_000n;
const decimal=(n:bigint)=>`${n/1_000_000_000_000n}.${String(n%1_000_000_000_000n).padStart(12,'0')}`.replace(/0+$/,'').replace(/\.$/,'');
function capture(f:ReturnType<typeof fixture>,n:number,empty=false):NativeCaptureDocument {
  return {id:'capture-'+jsonHash(f.identity)+'-'+String(n).padStart(6,'0'),identity:f.identity,sourceId:'original-runner',began:true,baselineRoot:'root',historicalRevisionGap:false,proof:NativeUsageProofSchema.parse({contract:'opencode-child-steps-v1',lineageKey:'original-fixture',turn:'turn-'+n,turnIndex:n,state:'complete',root:'root',observedAt:at,baseline:{kind:'fresh',fingerprint:null},fingerprint:jsonHash([f.identity,n,empty]),sessions:1,steps:empty?0:1,emitted:empty?0:1,baselineSteps:0,priorRevisionGap:false,issues:[]})};
}
async function seed(f:ReturnType<typeof fixture>,count:number,mode:'complete'|'missing-capture'|'unpriced'='complete') {
  for(let offset=0;offset<count;offset+=100) {
    const rows=Array.from({length:Math.min(100,count-offset)},(_,i)=>record(f,offset+i));
    const key=(r:UsageRecord)=>jsonHash({identity:r.identity,sourceId:r.sourceId,recordId:r.recordId});
    await tdb.db.insert(usageProjections).values(rows.map(document=>({meterKey:key(document),taskKey:f.taskKey,document})));
    await tdb.db.insert(executionValuations).values(rows.map((r,i)=>({meterKey:key(r),taskKey:f.taskKey,basisFingerprint:jsonHash(r),document:UsageValuationSchema.parse({kind:'valuation',identity:f.identity,sourceId:r.sourceId,recordId:r.recordId,revision:1,occurredAt:at,observedAt:at,valuationId:'value-'+(offset+i),valuationRevision:1,usageRevision:r.projection.projectionRevision,currency:'CNY',completeness:mode==='unpriced'&&offset+i===count-1?'partial':'complete',availability:'priced',priceVersionRef:'acceptance-only-CNY-not-supplier-bill',amountDecimal:decimal(pico(offset+i))})})));
    const captures=rows.flatMap((_,i)=>mode==='missing-capture'&&offset+i===count-1?[]:[capture(f,offset+i)]);
    if(captures.length) {
      await tdb.db.insert(nativeCaptures).values(captures.map(document=>({id:document.id,taskKey:f.taskKey,sourceId:document.sourceId,turn:document.proof.turn,lineageKey:document.proof.lineageKey,root:document.proof.root,finalized:true,document,summary:nativeCaptureSummary(document,{steps:1,baselines:0,unresolved:0,revised:0})})));
      await tdb.db.insert(nativeSteps).values(captures.map(document=>({captureId:document.id,recordId:'record-'+document.proof.turnIndex,taskKey:f.taskKey,nativeKey:jsonHash([f.identity,document.proof.turn]),root:'root',revision:1,fingerprint:document.proof.fingerprint!})));
    }
  }
  await tdb.db.insert(costVisibility).values({projectId:f.identity.projectId,revision:1,document:{projectId:f.identity.projectId,revision:1,visibility:'project-members-and-services',updatedAt:at}});
}
async function build(f:ReturnType<typeof fixture>,verify?:(result:Awaited<ReturnType<typeof buildCompleteRuntimeTask>>,snapshot:Parameters<Parameters<ReturnType<typeof originalReportSnapshotSession>['run']>[0]>[0])=>Promise<void>) {
  return originalReportSnapshotSession(tdb.handle).run(async(snapshot)=>{
    const result=await buildCompleteRuntimeTask({task:f.task,snapshotId:snapshot.snapshotId,asOf:snapshot.asOf,rows:snapshot.workspace,namespace:'original-task',keyOf:jsonHash,system:false,usageWorkspace:completeStatisticsWorkspace,ledger:completeRuntimeLedgerSources(snapshot.executor,f.task,snapshot.snapshotId,137),attempts:{next:async(after)=>{if(after!==null) throw new Error('Port fixture original EOF');return {items:[f.attempt],snapshotId:snapshot.snapshotId,nextCursor:null};}}});
    await verify?.(result,snapshot);return result;
  });
}
describe.skipIf(!available)('complete task reduction on original PG',()=>{
  test('10001 original projections, current values and native captures reach independent EOF and exact classified/CNY totals',async()=>{
    tdb=await createTestDatabase([observabilityMigrations]);const f=fixture(),count=10001;await seed(f,count);
    const result=await build(f,async(result,snapshot)=>{
      let seen=0n;const ids=new Set<string>();
      for await(const row of completeWorkingTraversal<CompleteRuntimeAllocation>(snapshot.workspace,result.allocationsNamespace)) {
        const n=Number(row.document.record.original.recordId.slice('record-'.length));
        expect(row.document.contribution).toEqual({input:String(n+1),cacheRead:'3',cacheWrite:'5',output:'7'});
        expect(ids.has(row.document.record.original.recordId)).toBe(false);ids.add(row.document.record.original.recordId);seen++;
      }
      expect(seen).toBe(10001n);expect([...ids].sort()).toEqual(Array.from({length:count},(_,n)=>'record-'+n).sort());
      expect(await snapshot.workspace.getMany<string>('no-such-derived-rows',['a','b'])).toEqual([]);
    });
    expect(result.timing).toEqual({wallMs:'10000',range:{from:at,to:'2026-10-03T00:00:10.000Z'},intervals:{state:'complete',unknown:'0',cumulativeMs:'10000',activeUnionMs:'10000'}});
    expect(result.attemptCount).toBe('1');expect(result.sourceReceipts.map(receipt=>receipt.rows)).toEqual(['1','10001','10001','10001']);
    if(result.metrics.state!=='ready') throw new Error(JSON.stringify(result.metrics));
    const input=BigInt(count)*BigInt(count+1)/2n;
    expect(result.metrics.tokens).toEqual({input:String(input),cacheRead:'30003',cacheWrite:'50005',output:'70007',total:String(input+150015n)});
    expect(result.metrics.records).toBe('10001');expect(result.metrics.executions).toBe('1');expect(result.metrics.observedExecutions).toBe('1');
    const total=input*2_000_000n+BigInt(count)*(3n*500_000n+5n*3_000_000n+7n*8_000_000n);
    expect(result.metrics.cost).toEqual({currency:'CNY',state:'complete',amount:decimal(total)});
  },60000);
  test('one missing original capture keeps complete totals unknown and incomplete pricing retains its exact recorded population',async()=>{
    tdb=await createTestDatabase([observabilityMigrations]);const missing=fixture();await seed(missing,17,'missing-capture');
    const partial=await build(missing);expect(partial.metrics).toMatchObject({state:'not-ready',gaps:['native-capture-unobserved'],recordedUsage:{records:'17',tokens:{input:'153',cacheRead:'51',cacheWrite:'85',output:'119',total:'408'},bucketRecords:{input:'17',cacheRead:'17',cacheWrite:'17',output:'17'}},costCoverage:{records:'17',pricedRecords:'17',visibility:'visible'},recordedCost:{currency:'CNY',amount:'0.0015385',records:'17',pricedRecords:'17'}});expect(partial.metrics).not.toHaveProperty('tokens');expect(partial.metrics).not.toHaveProperty('cost');
    expect(partial.sourceReceipts.map(receipt=>receipt.rows)).toEqual(['1','17','16','17']);
    const unpriced=fixture();await seed(unpriced,17,'unpriced');const result=await build(unpriced);
    if(result.metrics.state!=='ready') throw new Error(JSON.stringify(result.metrics));
    expect(result.metrics.records).toBe('17');expect(result.metrics.cost).toEqual({currency:'CNY',state:'unpriced',amount:null});
  },30000);
  test('zero requires an original complete empty proof and an Agent fact; empty sources without proof cannot qualify',async()=>{
    tdb=await createTestDatabase([observabilityMigrations]);const empty=fixture(),document=capture(empty,0,true);
    await tdb.db.insert(nativeCaptures).values({id:document.id,taskKey:empty.taskKey,sourceId:document.sourceId,turn:document.proof.turn,lineageKey:document.proof.lineageKey,root:document.proof.root,finalized:true,document,summary:nativeCaptureSummary(document,{steps:0,baselines:0,unresolved:0,revised:0})});
    await tdb.db.insert(costVisibility).values({projectId:empty.identity.projectId,revision:1,document:{projectId:empty.identity.projectId,revision:1,visibility:'project-members-and-services',updatedAt:at}});
    const result=await build(empty);if(result.metrics.state!=='ready') throw new Error(JSON.stringify(result.metrics));
    expect(result.metrics.tokens).toEqual({input:'0',cacheRead:'0',cacheWrite:'0',output:'0',total:'0'});expect(result.metrics.cost).toEqual({currency:'CNY',state:'complete',amount:'0'});
    expect(result.metrics.observedExecutions).toBe('1');expect(result.metrics.records).toBe('0');
    const invalid=fixture();invalid.task={...invalid.task,protocol:'development'};await expect(build(invalid)).rejects.toThrow('source identity missing');
    const absent=await build(fixture());expect(absent.metrics.state).toBe('not-ready');expect(absent.metrics).not.toHaveProperty('tokens');expect(absent.metrics).not.toHaveProperty('cost');
  },30000);
});
