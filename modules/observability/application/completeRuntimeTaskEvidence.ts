import type { UsageNativeCapture } from '@crewstation/contracts';
import { completeRuntimeGap,emptyCompleteRuntimeFold,type CompleteRuntimeFold } from '../domain/completeRuntimeMetrics';
import { assertCompleteAttempt,assertCompleteObserved,completeAttemptIdentity,completeObservedIdentity,completeCaptureIdentity,completeUsageIdentity,completeUsageCaptureIdentity } from '../domain/completeRuntimeIdentity';
import { runtimeContributionEvidence } from '../domain/completeUsageEvidence';
import { consumeCompleteSource } from './completePageTraversal';
import type { CompleteRuntimeTaskInput,CompleteAttemptWorking } from '../ports/completeRuntimeTask';
import type { CompleteSourceReader } from '../ports/completeReport';
import { completeWorkingCache } from './completeWorkingCache';

export function completeTaskEvidenceContext(input:CompleteRuntimeTaskInput,visible:boolean) {
  const space=(name:string)=>`${input.namespace}/${name}`;
  const usage=input.usageWorkspace({rows:input.rows,namespace:space('usage'),keyOf:input.keyOf,identity:(r:ReturnType<typeof runtimeContributionEvidence>)=>completeUsageIdentity(r.original),signal:input.signal});
  const fold=emptyCompleteRuntimeFold(visible);
  const attempts=completeWorkingCache<CompleteAttemptWorking>(input.rows,space('attempts'),input.signal);
  const traverse=<T>(source:string,reader:CompleteSourceReader<T>,append:(items:readonly T[])=>Promise<void>)=>consumeCompleteSource({source:space(source),snapshotId:input.snapshotId,reader,signal:input.signal,workspace:{claimCursor:async(_,cursor)=>input.rows.insert(space('cursors'),[{key:input.keyOf(JSON.stringify([source,cursor])),document:cursor}]),append:async(_,items)=>append(items)}});
  const attemptFor=async(identity:Parameters<typeof completeObservedIdentity>[0])=>{
    assertCompleteObserved(input.task,identity);
    const key=input.keyOf(completeObservedIdentity(identity));
    const entry=await attempts.get(key);
    if (!entry || entry.attempt.kind!=='agent') {completeRuntimeGap(fold,'identity-unmatched');return undefined;}
    return {key,entry};
  };
  return {input,space,usage,fold,traverse,attemptFor,attempts};
}
export type CompleteTaskEvidenceContext=ReturnType<typeof completeTaskEvidenceContext>;

export function retainCompleteAttempts(context:CompleteTaskEvidenceContext) {
  const {input,space}=context;
  return context.traverse('attempts',input.attempts,async(items)=>{
    for (const attempt of items) assertCompleteAttempt(input.task,attempt);
    await input.rows.insert(space('attempt-ids'),items.map(attempt=>({key:input.keyOf(completeAttemptIdentity(input.task,attempt)),document:true})));
    await input.rows.insert(space('attempts'),items.map(attempt=>({key:input.keyOf(completeAttemptIdentity(input.task,attempt)),document:{attempt,fold:emptyCompleteRuntimeFold(context.fold.visible,attempt.kind==='agent'?'1':'0'),rawUsage:'0',captures:'0',nativeEmpty:true,nativeComplete:true} satisfies CompleteAttemptWorking})));
  });
}
export function retainCompleteValuations(context:CompleteTaskEvidenceContext) {
  return context.traverse('valuations',context.input.ledger.valuations,async(items)=>{
    for (const value of items) await context.attemptFor(value.identity);
    await context.input.rows.insert(context.space('valuations'),items.map(document=>({key:context.input.keyOf(completeUsageIdentity(document)),document})));
  });
}
function qualifyCapture(fold:CompleteRuntimeFold,capture:UsageNativeCapture) {
  const p=capture.proof;
  const complete=capture.state==='complete' && p.state==='complete' && !!p.root && !!p.fingerprint && !p.priorRevisionGap && !p.issues.length && !capture.issues.length && !capture.historicalRevisionGap && !capture.revisedBaselineSteps && !capture.unresolvedBaselineSteps && capture.receivedSteps===p.emitted && p.steps===p.emitted+p.baselineSteps;
  if (!complete) completeRuntimeGap(fold,'native-capture-incomplete');
  return complete;
}
export function retainCompleteCaptures(context:CompleteTaskEvidenceContext) {
  const {input,space}=context;
  return context.traverse('captures',input.ledger.captures,async(items)=>{
    await input.rows.insert(space('capture-ids'),items.map(capture=>({key:capture.id,document:true})));
    await input.rows.insert(space('captures'),items.map(document=>({key:input.keyOf(completeCaptureIdentity(document)),document})));
    for (const capture of items) {
      const found=await context.attemptFor(capture.identity);if(!found) continue;
      const {key,entry}=found;
      entry.captures=(BigInt(entry.captures)+1n).toString();entry.nativeComplete &&= qualifyCapture(entry.fold,capture);
      entry.nativeEmpty &&= capture.receivedSteps===0 && capture.proof.emitted===0 && capture.proof.steps===capture.proof.baselineSteps;
      await context.attempts.put(key,entry);
    }
  });
}
export function retainCompleteUsage(context:CompleteTaskEvidenceContext) {
  const {input,space}=context;
  return context.traverse('records',input.ledger.usage,async(items)=>{
    const captureKeys=items.flatMap(record=>{const id=completeUsageCaptureIdentity(record);return id===null?[]:[input.keyOf(id)];});
    const captures=new Map((await input.rows.getMany<UsageNativeCapture>(space('captures'),captureKeys)).map(row=>[row.key,row.document]));
    for (const record of items) {
      const found=await context.attemptFor(record.identity);if(!found) continue;
      const {key,entry}=found;entry.rawUsage=(BigInt(entry.rawUsage)+1n).toString();
      const captureId=completeUsageCaptureIdentity(record);
      const capture=captureId===null?undefined:captures.get(input.keyOf(captureId));
      if (!capture) completeRuntimeGap(entry.fold,'native-capture-unobserved');
      else qualifyCapture(entry.fold,capture);
      await context.attempts.put(key,entry);
    }
    await context.usage.append(items.map(runtimeContributionEvidence));
  });
}
