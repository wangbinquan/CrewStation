import type { UsageValuation } from '@crewstation/contracts';
import { completeUsageIdentity } from '../domain/completeRuntimeIdentity';
import { TOKEN_BUCKETS } from '../domain/tokenUsage';
import { addCompleteRuntimeAllocation,completeRuntimeGap,mergeCompleteRuntimeFold,completeRuntimeMetrics } from '../domain/completeRuntimeMetrics';
import type { CompleteAttemptWorking,CompleteRuntimeAllocation } from '../ports/completeRuntimeTask';
import { completeWorkingPages } from './completeWorkingTraversal';
import type { CompleteTaskEvidenceContext } from './completeRuntimeTaskEvidence';
import { selectCompleteUsage } from './completeUsageSelection';

export async function allocateCompleteTaskUsage(context:CompleteTaskEvidenceContext,count:string) {
  context.usage.seal(count);
  const selection=await selectCompleteUsage(context.usage.workspace,context.input.signal);
  await context.usage.flush();
  if (selection.ambiguousOverlaps!=='0' || selection.unavailableSummaries!=='0') completeRuntimeGap(context.fold,'coverage-incomplete');
  for await (const page of completeWorkingPages<CompleteRuntimeAllocation>(context.input.rows,context.usage.allocationsNamespace,context.input.signal)) {
    const valueKeys=page.map(row=>context.input.keyOf(completeUsageIdentity(row.document.record.original)));
    const values=new Map((await context.input.rows.getMany<UsageValuation>(context.space('valuations'),valueKeys)).map(row=>[row.key,row.document]));
    const valued=[];
    for(const row of page) {
      const {record,contribution,quality}=row.document,original=record.original;
      const found=await context.attemptFor(original.identity);if(!found) continue;
      const {key,entry}=found;
      if (quality.ambiguous || quality.unavailable) completeRuntimeGap(entry.fold,'coverage-incomplete');
      if (!original.projection.complete || original.projection.issues.length) completeRuntimeGap(entry.fold,'usage-incomplete');
      const whole=TOKEN_BUCKETS.every(bucket=>contribution[bucket]===original.projection.contribution[bucket]);
      const valuation=values.get(context.input.keyOf(completeUsageIdentity(original)));
      addCompleteRuntimeAllocation(entry.fold,contribution,valuation,whole,original.projection.projectionRevision);
      valued.push({key:row.key,document:{...row.document,valuation:valuation??null,whole}});
      await context.attempts.put(key,entry);
    }
    await context.input.rows.upsert(context.usage.allocationsNamespace,valued);
  }
  return selection;
}
/** Zero requires the original complete empty native proof and the original Agent execution fact. */
function finishAttempt(entry:CompleteAttemptWorking) {
  if (entry.attempt.kind!=='agent') return;
  if (entry.captures==='0') completeRuntimeGap(entry.fold,'native-capture-unobserved');
  if (!entry.nativeComplete) completeRuntimeGap(entry.fold,'native-capture-incomplete');
  if (entry.rawUsage==='0') {
    if (entry.captures==='0' || !entry.nativeComplete || !entry.nativeEmpty) completeRuntimeGap(entry.fold,'usage-missing');
    else entry.fold.observedExecutions='1';
  } else {
    entry.fold.observedExecutions='1';
    if (entry.fold.records==='0') completeRuntimeGap(entry.fold,'usage-selection-missing');
  }
}
export async function finishCompleteTaskUsage(context:CompleteTaskEvidenceContext) {
  let count=0n;await context.attempts.flush();
  for await (const page of completeWorkingPages<CompleteAttemptWorking>(context.input.rows,context.space('attempts'),context.input.signal)) {
    const summaries=page.map(row=>{
      const entry=row.document;finishAttempt(entry);mergeCompleteRuntimeFold(context.fold,entry.fold);count++;
      return {key:row.key,document:{...entry.attempt,key:row.key,metrics:completeRuntimeMetrics(entry.fold)}};
    });
    await context.input.rows.upsert(context.space('attempts'),page);
    await context.input.rows.insert(context.space('attempt-summaries'),summaries);
  }
  if (context.input.task.source?.kind==='development-agent' && count!==1n) throw new Error('Original development execution must have exactly one admitted Agent');
  return count.toString();
}
