import {sql} from 'drizzle-orm';
import type {Executor} from '@crewstation/persistence';
import type {IncrementalRuntimeTask} from '../../../ports/incrementalRuntimeTasks';
import {RUNTIME_NATIVE_GAPS} from '../../../domain/runtime/runtimeNativeQuality';
/** Source completeness is indexed separately from the occurrence sums; a repaired proof does not rewrite token rows. */
export async function publishRuntimeSourceQuality(tx:Executor,task:IncrementalRuntimeTask|null,id:string){
 if(!task){await tx.execute(sql`DELETE FROM observability.runtime_source_quality WHERE task_id=${id}`);return;}
 const gaps=task.fold.gaps.filter(g=>RUNTIME_NATIVE_GAPS.some(reason=>reason===g)||['coverage-incomplete','identity-unmatched','attempt-owner-unavailable','task-owner-unavailable'].includes(g));
 if(!gaps.length){await tx.execute(sql`DELETE FROM observability.runtime_source_quality WHERE task_id=${id}`);return;}
 await tx.execute(sql`INSERT INTO observability.runtime_source_quality(task_id,project_id,source_kind,started_at,ended_at,gaps) VALUES(${id},${task.task.projectId},${task.task.source?.kind??'business-task'},${task.task.createdAt}::timestamptz,${null}::timestamptz,${JSON.stringify(gaps)}::jsonb) ON CONFLICT(task_id) DO UPDATE SET project_id=excluded.project_id,source_kind=excluded.source_kind,started_at=excluded.started_at,ended_at=excluded.ended_at,gaps=excluded.gaps`);
}
