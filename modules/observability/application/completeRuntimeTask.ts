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
  return {task:input.task,attemptCount,timing,fold:context.fold,metrics:completeRuntimeMetrics(context.fold),sourceReceipts:[attempts,valuations,captures,...(pagedCaptures?[pagedCaptures]:[]),usage],persistedThrough:await input.ledger.persistedThrough(),attemptsNamespace:context.space('attempt-summaries'),allocationsNamespace:context.usage.allocationsNamespace};
}
