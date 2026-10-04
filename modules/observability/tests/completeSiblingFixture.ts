// One fully proved sibling Task alongside the original incomplete Task; real PostgreSQL evidence.
import {ExecutionObservationIdentitySchema,NativeUsageProofSchema,RuntimeAttemptFactSchema,UsageValuationSchema} from '@crewstation/contracts';
import {jsonHash,newResourceId} from '@crewstation/kernel';
import type {TestDatabase} from '@crewstation/testkit';
import {usageProjections,executionValuations,nativeCaptures,nativeSteps} from '../adapters/persistence/tables';
import {rebuildUsageProjection,nativeCaptureSummary,type NativeCaptureDocument} from '../domain/usageProjection';
import type {completeCohortFixture} from './completeCohortFixture';
import {completeCohortWindow} from './completeCohortFixture';
export async function seedCompleteSibling(tdb:TestDatabase,f:ReturnType<typeof completeCohortFixture>) {
 const task=f.tasks[1]!,at=completeCohortWindow.from,attempt=RuntimeAttemptFactSchema.parse({id:newResourceId(),taskId:task.id,name:'Complete Sibling Agent',kind:'agent',state:'succeeded',attempt:1,executionId:newResourceId(),agentId:newResourceId(),profileId:f.profileId,profileRevision:7,createdAt:at,startedAt:at,endedAt:task.closedAt});
 const identity=ExecutionObservationIdentitySchema.parse({projectId:task.projectId,taskId:task.id,subtaskId:attempt.id,executionId:attempt.executionId,executionGeneration:1});
 const record=rebuildUsageProjection([{identity,kind:'usage',sourceId:'original-runner',recordId:'sibling-original-row',revision:1,occurredAt:at,observedAt:at,adapterVersion:'original-complete-sibling-fixture',modelRef:'original-model-reference',reporting:'delta',inclusion:'self',coverage:'complete',validity:'valid',scope:{root:'sibling-root',session:'sibling-root',parentSession:null,ancestors:[],turn:'sibling-turn',turnIndex:0,level:'request'},coveredThroughTurn:null,basis:{kind:'invocation'},usage:{input:'3',cacheRead:'9',cacheWrite:'15',output:'21'}}]);
 const meterKey=jsonHash({identity,sourceId:record.sourceId,recordId:record.recordId}),taskKey=jsonHash({projectId:task.projectId,taskId:task.id}),captureId=newResourceId();
 const capture:NativeCaptureDocument={id:captureId,identity,sourceId:record.sourceId,began:true,baselineRoot:'sibling-root',historicalRevisionGap:false,proof:NativeUsageProofSchema.parse({contract:'opencode-child-steps-v1',lineageKey:'sibling-lineage',turn:'sibling-turn',turnIndex:0,state:'complete',root:'sibling-root',observedAt:at,baseline:{kind:'fresh',fingerprint:null},fingerprint:jsonHash([identity,'sibling-turn']),sessions:1,steps:1,emitted:1,baselineSteps:0,priorRevisionGap:false,issues:[]})};
 const valuation=UsageValuationSchema.parse({kind:'valuation',identity,sourceId:record.sourceId,recordId:record.recordId,revision:1,occurredAt:at,observedAt:at,valuationId:'sibling-original-valuation',valuationRevision:1,usageRevision:record.projection.projectionRevision,currency:'CNY',completeness:'complete',availability:'priced',priceVersionRef:'ACCEPTANCE-ONLY-CNY-NOT-SUPPLIER-BILL',amountDecimal:'0.0002235'});
 await tdb.db.insert(usageProjections).values({meterKey,taskKey,document:record});
 await tdb.db.insert(executionValuations).values({meterKey,taskKey,basisFingerprint:jsonHash(record),document:valuation});
 await tdb.db.insert(nativeCaptures).values({id:captureId,taskKey,sourceId:capture.sourceId,turn:capture.proof.turn,lineageKey:capture.proof.lineageKey,root:capture.proof.root,finalized:true,document:capture,summary:nativeCaptureSummary(capture,{steps:1,baselines:0,unresolved:0,revised:0})});
 await tdb.db.insert(nativeSteps).values({captureId,recordId:record.recordId,taskKey,nativeKey:jsonHash([identity,capture.proof.turn]),root:capture.proof.root!,revision:1,fingerprint:capture.proof.fingerprint!});
 return {task,attempt,record,valuation};
}
