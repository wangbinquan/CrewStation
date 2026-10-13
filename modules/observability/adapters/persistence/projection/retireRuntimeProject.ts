import {sql} from 'drizzle-orm';
import type {Executor} from '@crewstation/persistence';
import type {IncrementalRuntimeTask} from '../../../ports/incrementalRuntimeTasks';
import {runtimeDailyDeltas} from '../../../domain/runtime/runtimeDailyDelta';
import {applyRuntimeDailyDeltas} from './runtimeDailyAggregate';
import {publishRuntimeSourceQuality} from '../incrementalRuntime/sourceQuality';
import {replaceRuntimeOccurrence} from '../runtimeOccurrence';
import {replaceRuntimeOccurrenceHours} from '../runtimeOccurrenceHours';
import {publishRuntimeScope} from '../incrementalRuntime/scopePublication';

/** Called under the original report/deletion locks. Other projects keep every current allocation and pending change. */
export async function retireRuntimeProjectProjection(tx:Executor,projects:readonly string[]){
 if(!projects.length)return;
 let removed=false;
 for(;;){
  const rows=await tx.execute<{task_id:string;document:IncrementalRuntimeTask|null}>(sql`SELECT ids.task_id,c.document FROM (SELECT task_id FROM observability.runtime_task_metadata WHERE project_id IN ${projects} UNION SELECT task_id FROM observability.runtime_task_cache WHERE project_id IN ${projects}) ids LEFT JOIN observability.runtime_task_cache c ON c.task_id=ids.task_id ORDER BY ids.task_id LIMIT 200`);
  if(!rows.length)break;
  for(const row of rows){
   const id=row.task_id,previous=row.document??undefined;
   await publishRuntimeSourceQuality(tx,null,id);
   await replaceRuntimeOccurrence(tx,null,id);
   await replaceRuntimeOccurrenceHours(tx,null,id);
   if(previous)await applyRuntimeDailyDeltas(tx,runtimeDailyDeltas(previous,null));
   for(const name of ['runtime_task_record_work','runtime_task_proof_work','runtime_task_metadata_work','runtime_task_current_rows','runtime_task_row_history','runtime_task_cache_rows','runtime_task_cache','runtime_task_metadata'] as const)await tx.execute(sql`DELETE FROM ${sql.identifier('observability')}.${sql.identifier(name)} WHERE task_id=${id}`);
   await tx.execute(sql`DELETE FROM observability.runtime_task_work WHERE key=${id}`);
   removed=true;
  }
 }
 await tx.execute(sql`DELETE FROM observability.runtime_daily_aggregates WHERE scope IN ${projects}`);
 await tx.execute(sql`DELETE FROM observability.runtime_task_work WHERE project_id IN ${projects} OR key IN ${projects.map(id=>'project:'+id)}`);
 if(removed){
  for(const project of projects)await publishRuntimeScope(tx,project);
  await tx.execute(sql`UPDATE observability.runtime_projection_head SET revision=revision+1,as_of=to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') WHERE singleton=true`);
  await tx.execute(sql`INSERT INTO observability.runtime_task_publications DEFAULT VALUES`);
 }
}
