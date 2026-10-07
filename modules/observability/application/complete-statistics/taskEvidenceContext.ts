import { completeRuntimeGap,emptyCompleteRuntimeFold } from '../../domain/completeRuntimeMetrics';
import { assertCompleteObserved,completeObservedIdentity,completeUsageIdentity } from '../../domain/completeRuntimeIdentity';
import type { runtimeContributionEvidence } from '../../domain/completeUsageEvidence';
import { consumeCompleteSource } from '../completePageTraversal';
import type { CompleteRuntimeTaskInput,CompleteAttemptWorking } from '../../ports/completeRuntimeTask';
import type { CompleteSourceReader } from '../../ports/completeReport';
import { completeWorkingCache } from '../completeWorkingCache';

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
