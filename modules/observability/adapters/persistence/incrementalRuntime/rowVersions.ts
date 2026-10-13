import {sql} from 'drizzle-orm';
import type {Executor} from '@crewstation/persistence';
import type {IncrementalRuntimeTask} from '../../../ports/incrementalRuntimeTasks';
export async function runtimeRowSequence(tx:Executor){const [r]=await tx.execute(sql`SELECT nextval('observability.runtime_row_publication_sequence')::text AS value`);return String(r!['value']);}
export async function publishRuntimeRows(tx:Executor,task:IncrementalRuntimeTask){const sequence=await runtimeRowSequence(tx);
 await tx.execute(sql`INSERT INTO observability.runtime_task_row_history(task_id,role,key,sequence,document) SELECT r.task_id,r.role,r.key,${sequence}::numeric,NULL FROM observability.runtime_task_current_rows r WHERE r.task_id=${task.task.id} AND NOT EXISTS(SELECT 1 FROM observability.runtime_task_cache_rows n WHERE n.task_id=r.task_id AND n.version=${task.version} AND n.role=r.role AND n.key=r.key)`);
 await tx.execute(sql`DELETE FROM observability.runtime_task_current_rows r WHERE r.task_id=${task.task.id} AND NOT EXISTS(SELECT 1 FROM observability.runtime_task_cache_rows n WHERE n.task_id=r.task_id AND n.version=${task.version} AND n.role=r.role AND n.key=r.key)`);
 await tx.execute(sql`INSERT INTO observability.runtime_task_row_history(task_id,role,key,sequence,document) SELECT r.task_id,r.role,r.key,${sequence}::numeric,r.document FROM observability.runtime_task_cache_rows r WHERE r.task_id=${task.task.id} AND r.version=${task.version} AND NOT EXISTS(SELECT 1 FROM observability.runtime_task_current_rows old WHERE old.task_id=r.task_id AND old.role=r.role AND old.key=r.key AND old.document=r.document)`);
 await tx.execute(sql`INSERT INTO observability.runtime_task_current_rows SELECT task_id,role,key,document FROM observability.runtime_task_cache_rows WHERE task_id=${task.task.id} AND version=${task.version} ON CONFLICT(task_id,role,key) DO UPDATE SET document=excluded.document WHERE observability.runtime_task_current_rows.document IS DISTINCT FROM excluded.document`);return sequence;
}
export async function putRuntimeRow(tx:Executor,task:string,sequence:string,role:string,key:string,document:unknown){await tx.execute(sql`INSERT INTO observability.runtime_task_current_rows VALUES(${task},${role},${key},${JSON.stringify(document)}::jsonb) ON CONFLICT(task_id,role,key) DO UPDATE SET document=excluded.document`);await tx.execute(sql`INSERT INTO observability.runtime_task_row_history VALUES(${task},${role},${key},${sequence}::numeric,${JSON.stringify(document)}::jsonb) ON CONFLICT(task_id,role,key,sequence) DO UPDATE SET document=excluded.document`);}

export async function removeRuntimeRow(tx:Executor,task:string,sequence:string,role:string,key:string){
 await tx.execute(sql`DELETE FROM observability.runtime_task_current_rows WHERE task_id=${task} AND role=${role} AND key=${key}`);
 await tx.execute(sql`INSERT INTO observability.runtime_task_row_history VALUES(${task},${role},${key},${sequence}::numeric,NULL) ON CONFLICT(task_id,role,key,sequence) DO UPDATE SET document=NULL`);
}
