import {RuntimeNativePagedCaptureSchema,type RuntimeNativePagedCapture,type UsageRecord} from '@crewstation/contracts';
import {completeRuntimeGap,type CompleteRuntimeFold} from '../../domain/completeRuntimeMetrics';
import {completePagedCaptureIdentity,completePagedUsageCaptureIdentity} from '../../domain/completeRuntimeIdentity';
import type {CompleteTaskEvidenceContext} from './taskEvidenceContext';
export function qualifyCompletePagedCapture(fold:CompleteRuntimeFold,capture:RuntimeNativePagedCapture) {
 const complete=capture.pass.phase==='final'&&capture.sourceState==='source-eof'&&capture.pathsComplete&&capture.workState==='processed'&&capture.numericEof&&capture.valuationEof&&capture.heldSteps==='0'&&capture.visitedSteps===capture.counts.steps&&['complete-before','complete-birth'].includes(capture.baselineState)&&!capture.issues.length;
 if(!complete)completeRuntimeGap(fold,'native-capture-incomplete');return complete;
}
export function retainCompletePagedCaptures(context:CompleteTaskEvidenceContext) {
 const reader=context.input.ledger.pagedCaptures;if(!reader)return undefined;
 const {input,space}=context;
 return context.traverse('native-pages',reader,async(items)=>{
  for(const item of items)RuntimeNativePagedCaptureSchema.parse(item);
  await input.rows.insert(space('paged-capture-ids'),items.map(c=>({key:c.id,document:true})));
  await input.rows.insert(space('native-pages'),items.map(document=>({key:input.keyOf(completePagedCaptureIdentity(document)),document})));
  for(const capture of items) {
   const found=await context.attemptFor(capture.identity);if(!found)continue;
   if(capture.pass.phase==='baseline')continue;
   const {key,entry}=found;entry.captures=String(BigInt(entry.captures)+1n);
   entry.nativeComplete&&=qualifyCompletePagedCapture(entry.fold,capture);entry.nativeEmpty&&=capture.counts.steps==='0';
   await context.attempts.put(key,entry);
  }
 });
}
export async function retainCompletePagedUsage(context:CompleteTaskEvidenceContext,items:readonly UsageRecord[]) {
 const {input,space}=context,keys=items.flatMap(record=>{const id=completePagedUsageCaptureIdentity(record);return id===null?[]:[input.keyOf(id)];});
 const captures=new Map((await input.rows.getMany<RuntimeNativePagedCapture>(space('native-pages'),keys)).map(row=>[row.key,row.document]));
 for(const record of items) {
  const captureId=completePagedUsageCaptureIdentity(record);if(captureId===null)continue;
  const found=await context.attemptFor(record.identity);if(!found)continue;
  const {key,entry}=found;entry.rawUsage=String(BigInt(entry.rawUsage)+1n);
  const capture=captures.get(input.keyOf(captureId));
  if(!capture||record.scope?.root!==capture.pass.rootSessionId||record.scope.turn!==capture.pass.turn||record.scope.turnIndex!==capture.turnIndex)completeRuntimeGap(entry.fold,'native-capture-unobserved');
  else qualifyCompletePagedCapture(entry.fold,capture);
  await context.attempts.put(key,entry);
 }
}
