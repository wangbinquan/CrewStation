import {prepareRuntimeMetadata} from '../../application/runtime/prepareRuntimeMetadata';
import {prepareRuntimePublicRows} from '../../application/runtime/qualifiedRuntimeRows';
import {usageIngestion} from '../../application/usageIngestion';
import {drizzleUsageLedger} from '../../adapters/persistence/drizzleUsageLedger';
// RFC-034: PostgreSQL original fact fixtures; no model or user resources are created.
import {sql} from 'drizzle-orm';
import {ExecutionObservationIdentitySchema,NativeUsageProofSchema,RuntimeAttemptFactSchema,RuntimeTaskHeaderFactSchema,UsageValuationSchema,type UsageRecord,type RuntimeTaskHeaderFact} from '@crewstation/contracts';
import {jsonHash,newResourceId} from '@crewstation/kernel';
import type {TestDatabase} from '@crewstation/testkit';
import {originalReportSnapshotSession} from '@crewstation/persistence';
import {buildCompleteRuntimeTask} from '../../application/completeRuntimeTask';
import {completeStatisticsWorkspace} from '../../wiring';
import {completeRuntimeLedgerSources} from '../../adapters/persistence/completeRuntimeLedgerSources';
import {executionValuations,nativeCaptures,nativeSteps,costVisibility} from '../../adapters/persistence/tables';
import {nativeCaptureSummary,rebuildUsageProjection,type NativeCaptureDocument} from '../../domain/usageProjection';
import {completeWorkingTraversal} from '../../application/completeWorkingTraversal';
import {prepareIncrementalRuntimeTasks} from '../../adapters/persistence/projection/incrementalRuntimeTaskPreparation';
import {incrementalRuntimeTaskCache,incrementalRuntimeTaskReader} from '../../adapters/persistence/projection/incrementalRuntimeTaskCache';
import type {CompleteRuntimeFactSourceFactory} from '../../ports/completeRuntimeFactSources';
import type {Executor} from '@crewstation/persistence';
const at='2026-10-03T00:00:00.000Z';
function fixture() {
  const identity=ExecutionObservationIdentitySchema.parse({projectId:newResourceId(),taskId:newResourceId(),subtaskId:newResourceId(),executionId:newResourceId(),executionGeneration:1});
  const task=RuntimeTaskHeaderFactSchema.parse({source:{kind:'business-task'},id:identity.taskId,projectId:identity.projectId,serviceId:newResourceId(),projectName:'Original project fixture',name:'Complete original PG usage fixture',protocol:'v3',state:'closed',createdAt:at,closedAt:'2026-10-03T00:00:10.000Z',traceId:null});
  const attempt=RuntimeAttemptFactSchema.parse({id:identity.subtaskId,taskId:identity.taskId,name:'Owner port fixture',kind:'agent',state:'succeeded',attempt:1,executionId:identity.executionId,agentId:newResourceId(),profileId:newResourceId(),profileName:'Acceptance only CNY',profileRevision:3,createdAt:at,startedAt:at,endedAt:'2026-10-03T00:00:10.000Z'});
  return {identity,task,attempt,taskKey:jsonHash({projectId:identity.projectId,taskId:identity.taskId})};
}
function record(f:ReturnType<typeof fixture>,n:number):UsageRecord {
  return rebuildUsageProjection([{kind:'usage',identity:f.identity,sourceId:'original-runner',recordId:'record-'+n,revision:1,occurredAt:at,observedAt:at,adapterVersion:'original-pg-fixture',modelRef:null,reporting:'delta',inclusion:'self',coverage:'complete',validity:'valid',scope:{root:'root',session:'root',parentSession:null,ancestors:[],turn:'turn-'+n,turnIndex:n,level:'request'},coveredThroughTurn:null,basis:{kind:'invocation'},usage:{input:String(n+1),cacheRead:'3',cacheWrite:'5',output:'7'}}]);
}
const pico=(n:number)=>BigInt(n+1)*2_000_000n+3n*500_000n+5n*3_000_000n+7n*8_000_000n;
const decimal=(n:bigint)=>`${n/1_000_000_000_000n}.${String(n%1_000_000_000_000n).padStart(12,'0')}`.replace(/0+$/,'').replace(/\.$/,'');
function capture(f:ReturnType<typeof fixture>,n:number,empty=false):NativeCaptureDocument {
  return {id:'capture-'+jsonHash(f.identity)+'-'+String(n).padStart(6,'0'),identity:f.identity,sourceId:'original-runner',began:true,baselineRoot:'root',historicalRevisionGap:false,proof:NativeUsageProofSchema.parse({contract:'opencode-child-steps-v1',lineageKey:'original-fixture',turn:'turn-'+n,turnIndex:n,state:'complete',root:'root',observedAt:at,baseline:{kind:'fresh',fingerprint:null},fingerprint:jsonHash([f.identity,n,empty]),sessions:1,steps:empty?0:1,emitted:empty?0:1,baselineSteps:0,priorRevisionGap:false,issues:[]})};
}
async function seed(tdb:TestDatabase,f:ReturnType<typeof fixture>,count:number,mode:'complete'|'missing-capture'|'unpriced'='complete') {
  for(let offset=0;offset<count;offset+=100) {
    const rows=Array.from({length:Math.min(100,count-offset)},(_,i)=>record(f,offset+i));
    const key=(r:UsageRecord)=>jsonHash({identity:r.identity,sourceId:r.sourceId,recordId:r.recordId});
    const ingest=usageIngestion(drizzleUsageLedger(tdb.db));await ingest({projectId:f.identity.projectId,taskId:f.identity.taskId,sourceId:'original-runner',expectedCursor:offset===0?null:'original:'+offset,nextCursor:'original:'+(offset+rows.length),events:rows.map((row,n)=>{const {projection:_projection,...measurement}=row;return {eventId:'original:'+String(offset+n),measurement};})});
    await tdb.db.insert(executionValuations).values(rows.map((r,i)=>({meterKey:jsonHash({kind:'valuation',usageKey:key(r)}),taskKey:f.taskKey,basisFingerprint:jsonHash(r),document:UsageValuationSchema.parse({kind:'valuation',identity:f.identity,sourceId:r.sourceId,recordId:r.recordId,revision:1,occurredAt:at,observedAt:at,valuationId:'value-'+(offset+i),valuationRevision:1,usageRevision:r.projection.projectionRevision,currency:'CNY',completeness:mode==='unpriced'&&offset+i===count-1?'partial':'complete',availability:'priced',priceVersionRef:'acceptance-only-CNY-not-supplier-bill',amountDecimal:decimal(pico(offset+i))})})));
    const captures=rows.flatMap((_,i)=>mode==='missing-capture'&&offset+i===count-1?[]:[capture(f,offset+i)]);
    if(captures.length) {
      await tdb.db.insert(nativeCaptures).values(captures.map(document=>({id:document.id,taskKey:f.taskKey,sourceId:document.sourceId,turn:document.proof.turn,lineageKey:document.proof.lineageKey,root:document.proof.root,finalized:true,document,summary:nativeCaptureSummary(document,{steps:1,baselines:0,unresolved:0,revised:0})})));
      await tdb.db.insert(nativeSteps).values(captures.map(document=>({captureId:document.id,recordId:'record-'+document.proof.turnIndex,taskKey:f.taskKey,nativeKey:jsonHash([f.identity,document.proof.turn]),root:'root',revision:1,fingerprint:document.proof.fingerprint!})));
    }
  }
  await tdb.db.insert(costVisibility).values({projectId:f.identity.projectId,revision:1,document:{projectId:f.identity.projectId,revision:1,visibility:'project-members-and-services',updatedAt:at}});
}

export async function incrementalFixture(tdb:TestDatabase,count=3){
 const f=fixture();await seed(tdb,f,count);let builds=0,currentTask=f.task;
 const facts:CompleteRuntimeFactSourceFactory<Executor>=(_tx,query,snapshotId)=>{const source=<T>(items:readonly T[])=>({next:async(after:string|null)=>{if(after!==null)throw Error('Owner fixture EOF');return {snapshotId,items,nextCursor:null};}});return {tasks:{'business-task':source(query.taskId&&query.taskId!==f.task.id||query.projectId&&query.projectId!==f.task.projectId?[]:[currentTask]),'development-agent':source([]),'development-cli':source([])},attempts:()=>source([f.attempt]),projectName:async()=>f.task.projectName??null,profileName:async()=>f.attempt.profileName??null};};
 const source=prepareIncrementalRuntimeTasks({metadata:prepareRuntimeMetadata,publicRows:prepareRuntimePublicRows,db:tdb.db,snapshot:originalReportSnapshotSession(tdb.handle),facts,records:(rows,space,signal)=>completeWorkingTraversal(rows,space,signal),build:async(snapshot,task,namespace,signal)=>{builds++;return buildCompleteRuntimeTask({task,snapshotId:snapshot.snapshotId,asOf:snapshot.asOf,rows:snapshot.workspace,namespace,keyOf:jsonHash,system:true,usageWorkspace:completeStatisticsWorkspace,signal,ledger:completeRuntimeLedgerSources(snapshot.executor,task,snapshot.snapshotId),attempts:facts(snapshot.executor,{from:at,to:'2026-10-31T00:00:00.000Z',timezone:'UTC'},snapshot.snapshotId).attempts(task)});}}),store=incrementalRuntimeTaskCache(tdb.db);
 async function qualify(){for(;;){const [row]=await tdb.db.execute(sql`SELECT key,revision::text FROM observability.runtime_task_work WHERE key=${f.task.id} OR key=${'project:'+f.task.projectId} OR key LIKE 'global:%' ORDER BY CASE WHEN key=${f.task.id} THEN 1 ELSE 0 END,key LIMIT 1`);if(!row)return;const work={key:String(row['key']),revision:String(row['revision'])};if(work.key.startsWith('project:')||work.key.startsWith('global:')){await source.inventory(work.key.startsWith('project:')?work.key.slice(8):undefined);await store.acknowledge(work);}else await source.qualify(work);}}
 await qualify();await store.finishBootstrap();
 return {...f,source,store,reader:incrementalRuntimeTaskReader(tdb.db),qualify,builds:()=>builds,record:(n:number)=>record(f,n),capture:(n:number,empty=false)=>capture(f,n,empty),metrics:async()=> (await incrementalRuntimeTaskReader(tdb.db).task(f.task.id))!.fold,append:async(record:UsageRecord)=>{const ledger=drizzleUsageLedger(tdb.db),cursor=await ledger.cursor(f.identity,'original-runner'),{projection:_projection,...measurement}=record;await usageIngestion(ledger)({projectId:f.identity.projectId,taskId:f.identity.taskId,sourceId:'original-runner',expectedCursor:cursor,nextCursor:'original:'+newResourceId(),events:[{eventId:'correction:'+newResourceId(),measurement}]});},replaceHeader:async(task:RuntimeTaskHeaderFact)=>store.metadata([task]),metadata:async(task:RuntimeTaskHeaderFact)=>{currentTask=task;await tdb.db.execute(sql`SELECT observability.dirty_runtime_metadata(${f.task.id},${f.task.projectId})`);}};
}
