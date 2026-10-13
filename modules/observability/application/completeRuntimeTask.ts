import {enrichRuntimePhases} from './runtime/enrichRuntimePhases';
import {retainRunnerActivityPhases} from './runtime/runnerActivityPhases';
import {completeWorkingTraversal} from './completeWorkingTraversal';
import {retainRuntimeFragments} from './runtime/runtimeFragments';
import {runtimePhaseTiming} from './runtime/runtimePhaseTiming';
import {retainCliActivityPhases} from './runtime/cliActivityPhases';
import {assertCompleteTask} from '../domain/completeRuntimeIdentity';
import {buildCompleteTaskTiming} from './completeRuntimeTiming';
import { retainCompletePagedCaptures } from './complete-statistics/nativeCaptureEvidence';
import { completeRuntimeMetrics } from '../domain/completeRuntimeMetrics';
import type { CompleteRuntimeTaskInput,CompleteRuntimeTaskBuild } from '../ports/completeRuntimeTask';
import { completeTaskEvidenceContext,retainCompleteAttempts,retainCompleteValuations,retainCompleteCaptures,retainCompleteUsage } from './completeRuntimeTaskEvidence';
import { allocateCompleteTaskUsage,finishCompleteTaskUsage } from './completeRuntimeTaskUsage';

/** Original EOF of all available independent sources precedes canonical selection and any published total. */
export async function buildCompleteRuntimeTask(input:CompleteRuntimeTaskInput):Promise<CompleteRuntimeTaskBuild> {
  if (!input.snapshotId || input.ledger.snapshotId!==input.snapshotId || !Number.isSafeInteger(Date.parse(input.asOf))) throw new Error('Complete task snapshot identity missing');
  assertCompleteTask(input.task);
  const visible=input.system || await input.ledger.costVisible();
  const context=completeTaskEvidenceContext(input,visible);
  const attempts=await retainCompleteAttempts(context);
  const valuations=await retainCompleteValuations(context);
  const captures=await retainCompleteCaptures(context);
  const pagedCaptures=await retainCompletePagedCaptures(context);
  const usage=await retainCompleteUsage(context);
  await allocateCompleteTaskUsage(context,usage.rows);
  const attemptCount=await finishCompleteTaskUsage(context);
  if (attemptCount!==attempts.rows) throw new Error('Complete attempt EOF population changed');
  const timing=await buildCompleteTaskTiming({task:input.task,asOf:input.asOf,rows:input.rows,attemptsNamespace:context.space('attempt-summaries'),namespace:context.space('timing'),signal:input.signal});
  const phases=input.activity?await retainCliActivityPhases({task:input.task,reader:input.activity,rows:input.rows,namespace:input.namespace+'/cli-activity',snapshotId:input.snapshotId,asOf:input.asOf,keyOf:input.keyOf,signal:input.signal}):undefined;
  const fragments=await retainRuntimeFragments(input);
  const phasesNamespace=phases?.namespace??input.namespace+'/lifecycle-phases';
  if(fragments&&input.task.source?.kind!=='development-cli'){const driver=await retainRunnerActivityPhases(input.rows,fragments.namespace,input.namespace+'/driver-phases',input.task.id,input.signal);for await(const row of completeWorkingTraversal(input.rows,driver.namespace,input.signal))await input.rows.upsert(phasesNamespace,[row]);}
  if(input.lifecycle?.length)await input.rows.upsert(phasesNamespace,input.lifecycle.map(document=>({key:document.key,document})));
  await enrichRuntimePhases(input.rows,phasesNamespace,context.space('attempt-summaries'),input.signal);
  const phaseTiming=phases||fragments||input.lifecycle?.length?await runtimePhaseTiming(input.rows,phasesNamespace,input.signal):undefined;
  return {...(fragments?{fragmentsNamespace:fragments.namespace}:{}),...(phaseTiming?{phasesNamespace,phaseTiming}:{}),task:input.task,attemptCount,timing,fold:context.fold,metrics:completeRuntimeMetrics(context.fold),sourceReceipts:[...(fragments?fragments.receipts:[]),attempts,valuations,captures,...(pagedCaptures?[pagedCaptures]:[]),usage],persistedThrough:await input.ledger.persistedThrough(),attemptsNamespace:context.space('attempt-summaries'),allocationsNamespace:context.usage.allocationsNamespace};
}
