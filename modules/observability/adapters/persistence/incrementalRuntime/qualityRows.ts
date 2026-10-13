import {sql} from 'drizzle-orm';
import type {Executor} from '@crewstation/persistence';
import {jsonHash} from '@crewstation/kernel';
import type {IncrementalRuntimeTask} from '../../../ports/incrementalRuntimeTasks';
import {runtimeTaskQuality} from '../../../domain/runtime/runtimeTaskQuality';
import {putRuntimeRow,removeRuntimeRow} from './rowVersions';
export async function patchRuntimeQuality(tx:Executor,before:IncrementalRuntimeTask,next:IncrementalRuntimeTask,sequence:string){
 const old=new Set(runtimeTaskQuality(before.task,before.fold,before.build.timing)),now=new Set(runtimeTaskQuality(next.task,next.fold,next.build.timing));
 for(const reason of new Set([...old,...now])){if(old.has(reason)===now.has(reason))continue;const adding=now.has(reason);
  for(const parent of [null,reason]){const countKey=jsonHash(JSON.stringify(['quality',parent])),[stored]=await tx.execute(sql`SELECT document FROM observability.runtime_task_current_rows WHERE task_id=${next.task.id} AND role='public-counts' AND key=${countKey}`),n=BigInt((stored?.['document'] as {total:string}|undefined)?.total??'0')+(adding?1n:-1n);if(n<0n)throw Error('Original quality population missing');await putRuntimeRow(tx,next.task.id,sequence,'public-counts',countKey,{section:'quality',parent,total:String(n)});
   if(adding){const key=jsonHash([reason,parent,next.task.id]),document={taskId:next.task.id,taskName:next.task.name,projectId:next.task.projectId,projectName:next.task.projectName??null,reason};await putRuntimeRow(tx,next.task.id,sequence,'public-rows','quality/'+key,{section:'quality',parent,key:parent===null?jsonHash(JSON.stringify([reason,next.task.id])):next.task.id,document});}
   else{const rows=await tx.execute(sql`SELECT key FROM observability.runtime_task_current_rows WHERE task_id=${next.task.id} AND role='public-rows' AND document->>'section'='quality' AND coalesce(document->>'parent','')=${parent??''} AND document#>>'{document,reason}'=${reason}`);for(const row of rows)await removeRuntimeRow(tx,next.task.id,sequence,'public-rows',String(row['key']));}
  }
 }
}
