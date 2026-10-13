import {sql} from 'drizzle-orm';
import type {Executor} from '@crewstation/persistence';
import {jsonHash} from '@crewstation/kernel';
import type {CompleteRuntimeAllocation} from '../../../ports/completeRuntimeTask';
import {emptyCompleteRuntimeFold,type CompleteRuntimeFold} from '../../../domain/completeRuntimeMetrics';
import {runtimeRecordDelta} from '../../../domain/runtime/runtimeRecordDelta';
import {putRuntimeRow,removeRuntimeRow} from './rowVersions';
type Dimension={key:string;metadata:unknown;fold:CompleteRuntimeFold;count:string};
/** A late actual model moves only this record's contribution, including original execution membership. */
export async function patchRuntimeModel(tx:Executor,task:string,allocationKey:string,sequence:string,old:CompleteRuntimeAllocation|undefined,next:CompleteRuntimeAllocation){
 const oldModel=old?.record.original.modelRef,newModel=next.record.original.modelRef;
 const models=new Set<string|null>([newModel,...(old?[oldModel!]:[])]);
 for(const model of models){
  const modelKey=JSON.stringify(model),key=jsonHash(modelKey),[stored]=await tx.execute(sql`SELECT document FROM observability.runtime_task_current_rows WHERE task_id=${task} AND role='dimension-models' AND key=${key}`),previous=stored?.['document'] as Dimension|undefined;
  const before=old&&old.record.original.modelRef===model?old:undefined,after=newModel===model?next:null;
  if(!previous&&before)throw Error('Original model dimension membership missing');
  const fold=runtimeRecordDelta(previous?.fold??emptyCompleteRuntimeFold(true),before,after);
  const identity=next.record.original.identity,[other]=await tx.execute(sql`SELECT EXISTS(SELECT 1 FROM observability.runtime_task_current_rows WHERE task_id=${task} AND role='allocations' AND key<>${allocationKey} AND document#>'{record,original,identity}'=${JSON.stringify(identity)}::jsonb AND document#>>'{record,original,modelRef}' IS NOT DISTINCT FROM ${model}) AS value`);
  if(other?.['value']!==true){const change=BigInt(after?1:0)-BigInt(before?1:0);fold.executions=String(BigInt(fold.executions)+change);fold.observedExecutions=fold.executions;}
  if(BigInt(fold.records)===0n){await removeRuntimeRow(tx,task,sequence,'dimension-models',key);continue;}
  fold.priced=fold.pricedRecords===fold.records;
  const actual=after?.actualModel??before?.actualModel;
  await putRuntimeRow(tx,task,sequence,'dimension-models',key,{key:modelKey,metadata:{modelRef:model,...(actual?{actualModel:actual}:{})},fold,count:'1'});
 }
}
