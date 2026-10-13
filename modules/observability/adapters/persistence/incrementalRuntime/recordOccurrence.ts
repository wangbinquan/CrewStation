import type {Executor} from '@crewstation/persistence';
import type {IncrementalRuntimeTask} from '../../../ports/incrementalRuntimeTasks';
import type {CompleteRuntimeAllocation} from '../../../ports/completeRuntimeTask';
import {runtimeAllocationFold} from '../../../domain/runtime/runtimeRecordDelta';
import {completeObservedIdentity} from '../../../domain/completeRuntimeIdentity';
import {patchOccurrenceRecord} from './occurrenceRecord';
export async function patchRuntimeOccurrence(tx:Executor,task:IncrementalRuntimeTask,key:string,allocation:CompleteRuntimeAllocation){
 const o=allocation.record.original,fold=runtimeAllocationFold(allocation);fold.executions='1';fold.observedExecutions='1';fold.gaps=[...new Set([...fold.gaps,...task.fold.gaps.filter(g=>g!=='usage-missing')])];
 await patchOccurrenceRecord(tx,{ownerId:task.task.id,projectId:task.task.projectId,sourceKind:task.task.source?.kind??'business-task',key,execution:completeObservedIdentity(o.identity),at:o.occurredAt},fold);
}
