import type {RuntimeTaskHeaderFact,CompleteRuntimeTaskSummary} from '@crewstation/contracts';
import {completeRuntimeSourceKind} from '../../domain/completeRuntimeCohort';
import type {CompleteRuntimeCohortInput,CompleteRuntimeCohortBuild} from '../../ports/completeRuntimeCohort';
import {consumeCompleteSource} from '../completePageTraversal';
import {completeWorkingTraversal} from '../completeWorkingTraversal';
import {completeExternalSort} from '../completeExternalSort';
import {completeCohortContext} from './cohortContext';
import {completeRuntimeDurations} from './durations';
/** Retain both original header populations through EOF before any task or child statistics. */
async function retainCompleteCohortHeaders(input:CompleteRuntimeCohortInput) {
  const receipts=[];
  for(const kind of ['business-task','development-agent'] as const) {
    const source=input.namespace+'/headers/'+kind;
    receipts.push(await consumeCompleteSource({source,snapshotId:input.snapshotId,reader:input.facts.tasks[kind],signal:input.signal,workspace:{
      claimCursor:async(_,cursor)=>input.rows.insert(input.namespace+'/header-cursors',[{key:input.keyOf(JSON.stringify([kind,cursor])),document:cursor}]),
      append:async(_,items)=>{
        if(items.some(task=>completeRuntimeSourceKind(task)!==kind))throw new Error('Original task owner source changed');
        await input.rows.insert(input.namespace+'/header-ids',items.map(task=>({key:task.id,document:kind})));
        await input.rows.insert(input.namespace+'/headers',items.map(task=>({key:task.id,document:task})));
      },
    }}));
  }
  return receipts;
}
export async function buildCompleteRuntimeCohort(input:CompleteRuntimeCohortInput):Promise<CompleteRuntimeCohortBuild> {
  const sourceReceipts=await retainCompleteCohortHeaders(input),context=completeCohortContext(input);
  for await(const row of completeWorkingTraversal<RuntimeTaskHeaderFact>(input.rows,input.namespace+'/headers',input.signal))await context.retain(row.document);
  await context.dimensions.finish();
  const tasks=await completeExternalSort({workspace:input.rows,namespace:input.namespace+'/tasks-sort',records:(async function*(){for await(const row of completeWorkingTraversal<CompleteRuntimeTaskSummary>(input.rows,input.namespace+'/tasks',input.signal))yield row.document;})(),compare:(a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)||a.id.localeCompare(b.id),signal:input.signal});
  for await(const task of tasks.records())await context.reportRows.append('tasks',null,task.id,task);
  if(tasks.rows!==context.count())throw new Error('Complete original task population changed');
  await context.reportRows.finalizeCounts();
  const durations=await completeRuntimeDurations(input,context.missingDuration());
  return {summary:context.finishSummary(durations),fold:context.fold,sourceReceipts,readyRowsNamespace:context.reportRows.namespace,countsNamespace:context.reportRows.countsNamespace,receiptsNamespace:input.namespace+'/source-receipts'};
}
