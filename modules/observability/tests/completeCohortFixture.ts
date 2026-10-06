// Source-owner facts are explicit port fixtures; usage, valuations and native proofs are original PG rows.
import {ExecutionObservationIdentitySchema,NativeUsageProofSchema,RuntimeAttemptFactSchema,RuntimeTaskHeaderFactSchema,UsageValuationSchema,type UsageRecord,type UsageValuation,type RuntimeTaskHeaderFact} from '@crewstation/contracts';
import {jsonHash,newResourceId} from '@crewstation/kernel';
import type {TestDatabase} from '@crewstation/testkit';
import {usageProjections,executionValuations,nativeCaptures,nativeSteps} from '../adapters/persistence/tables';
import {rebuildUsageProjection,nativeCaptureSummary,type NativeCaptureDocument} from '../domain/usageProjection';
export const completeCohortWindow={from:'2026-10-03T00:00:00.000Z',to:'2026-10-04T00:00:00.000Z',timezone:'Asia/Shanghai'};
const at=completeCohortWindow.from;
export function completeCohortFixture() {
 const projectId=newResourceId(),profileId=newResourceId(),serviceId=newResourceId(),subtaskId=newResourceId();
 const tasks=Array.from({length:201},(_,n)=>RuntimeTaskHeaderFactSchema.parse({source:{kind:'business-task'},id:newResourceId(),projectId,serviceId,name:'Original Task '+n,protocol:'v3',state:'closed',createdAt:at,closedAt:'2026-10-03T00:00:10.000Z',traceId:null}));
 const attempts=Array.from({length:1001},(_,n)=>RuntimeAttemptFactSchema.parse({id:subtaskId,taskId:tasks[0]!.id,name:'Original Agent '+n,kind:'agent',state:'succeeded',attempt:n+1,executionId:newResourceId(),agentId:newResourceId(),profileId,profileRevision:7,createdAt:at,startedAt:at,endedAt:'2026-10-03T00:00:10.000Z'}));
 const identity=(n:number)=>ExecutionObservationIdentitySchema.parse({projectId,taskId:tasks[0]!.id,subtaskId:attempts[n]!.id,executionId:attempts[n]!.executionId,executionGeneration:attempts[n]!.attempt});
 const records=attempts.map((_,n):UsageRecord=>rebuildUsageProjection([{identity:identity(n),kind:'usage',sourceId:'original-runner',recordId:'record-'+n,revision:1,occurredAt:at,observedAt:at,adapterVersion:'original-complete-cohort-fixture',modelRef:'original-model-reference',reporting:'delta',inclusion:'self',coverage:'complete',validity:'valid',scope:{root:'root-'+n,session:'root-'+n,parentSession:null,ancestors:[],turn:'turn-'+n,turnIndex:n,level:'request'},coveredThroughTurn:null,basis:{kind:'invocation'},usage:{input:String(n+1),cacheRead:'3',cacheWrite:'5',output:'7'}}]));
 const pico=(n:number)=>BigInt(n+1)*2_000_000n+3n*500_000n+5n*3_000_000n+7n*8_000_000n;
 const decimal=(n:bigint)=>`${n/1_000_000_000_000n}.${String(n%1_000_000_000_000n).padStart(12,'0')}`.replace(/0+$/,'').replace(/\.$/,'');
 const captures=Array.from({length:2001},(_,n):NativeCaptureDocument=>{const index=n%1001,empty=n>=1001;return {id:'capture-'+n,identity:identity(index),sourceId:'original-runner',began:true,baselineRoot:'root-'+index,historicalRevisionGap:false,proof:NativeUsageProofSchema.parse({contract:'opencode-child-steps-v1',lineageKey:'original-fixture',turn:empty?'empty-'+n:'turn-'+index,turnIndex:n,state:'complete',root:'root-'+index,observedAt:at,baseline:{kind:'fresh',fingerprint:null},fingerprint:jsonHash([n,identity(index)]),sessions:1,steps:empty?0:1,emitted:empty?0:1,baselineSteps:0,priorRevisionGap:false,issues:[]})};});
 const reader=<T>(rows:readonly T[],snapshotId:string)=>({next:async(after:string|null)=>{const start=after===null?0:Number(after),items=rows.slice(start,start+37);return {snapshotId,items,nextCursor:start+items.length<rows.length?String(start+items.length):null};}});
 return {projectId,profileId,tasks,attempts,records,captures,pico,decimal,identity,
  facts:(snapshotId:string)=>({tasks:{'business-task':reader(tasks,snapshotId),'development-agent':reader<RuntimeTaskHeaderFact>([],snapshotId)},attempts:(task:RuntimeTaskHeaderFact)=>reader(task.id===tasks[0]!.id?attempts:[],snapshotId),projectName:async()=> 'Original Project Name',profileName:async()=> 'Original Compute Name'}),
 };
}
export async function seedCompleteCohort(tdb:TestDatabase,f:ReturnType<typeof completeCohortFixture>,missingLastCapture=false,valuationTransform?:(value:UsageValuation,record:UsageRecord,index:number)=>UsageValuation) {
 const transform=(value:UsageValuation,record:UsageRecord,index:number)=>valuationTransform?UsageValuationSchema.parse(valuationTransform(value,record,index)):value;
 const taskKey=jsonHash({projectId:f.projectId,taskId:f.tasks[0]!.id}),key=(record:UsageRecord)=>jsonHash({identity:record.identity,sourceId:record.sourceId,recordId:record.recordId});
 for(let start=0;start<f.records.length;start+=100){const rows=f.records.slice(start,start+100);await tdb.db.insert(usageProjections).values(rows.map(document=>({meterKey:key(document),taskKey,document})));await tdb.db.insert(executionValuations).values(rows.map((record,index)=>({meterKey:key(record),taskKey,basisFingerprint:jsonHash(record),document:transform(UsageValuationSchema.parse({kind:'valuation',identity:record.identity,sourceId:record.sourceId,recordId:record.recordId,revision:1,occurredAt:at,observedAt:at,valuationId:'value-'+(start+index),valuationRevision:1,usageRevision:record.projection.projectionRevision,currency:'CNY',completeness:'complete',availability:'priced',priceVersionRef:'ACCEPTANCE-ONLY-CNY-NOT-SUPPLIER-BILL',amountDecimal:f.decimal(f.pico(start+index))}),record,start+index)})));}
 for(let start=0;start<f.captures.length;start+=100){
  const rows=f.captures.slice(start,start+100).filter(capture=>!missingLastCapture||capture.id!=='capture-1000');
  if(rows.length)await tdb.db.insert(nativeCaptures).values(rows.map(document=>({id:document.id,taskKey,sourceId:document.sourceId,turn:document.proof.turn,lineageKey:document.proof.lineageKey,root:document.proof.root,finalized:true,document,summary:nativeCaptureSummary(document,{steps:document.proof.steps,baselines:0,unresolved:0,revised:0})})));
  const steps=rows.flatMap(capture=>{const n=Number(capture.id.slice('capture-'.length));return n<1001?[{captureId:capture.id,recordId:'record-'+n,taskKey,nativeKey:jsonHash([f.identity(n),capture.proof.turn]),root:'root-'+n,revision:1,fingerprint:capture.proof.fingerprint!}]:[];});
  if(steps.length)await tdb.db.insert(nativeSteps).values(steps);
 }
}
