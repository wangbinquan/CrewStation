import {sql} from 'drizzle-orm';
import {precondition} from '@crewstation/kernel';
import type {Executor} from '@crewstation/persistence';
import {runtimeReportAdmissionKey} from '../../../ports/completeRuntimeReportCache';
/** Enter before locking a derived parent; deletion never waits while holding that parent. */
export async function admitRuntimeReport(db:Executor) {
 await db.execute(sql`SELECT pg_advisory_xact_lock_shared(hashtextextended(${runtimeReportAdmissionKey},0))`);
}
export async function assertRuntimeReportProjects(db:Executor,id:string,projectId?:string|null) {
 const closed=await db.execute(sql`SELECT f.project_id FROM observability.deletion_fences f WHERE f.project_id=${projectId??''} OR EXISTS(SELECT 1 FROM observability.runtime_report_rows r WHERE r.report_id=${id} AND r.section='tasks' AND (r.document->>'projectId'=f.project_id OR f.original->'projectKeys' ? (r.document->>'projectId'))) LIMIT 1`);
 if(closed.length)throw precondition('报告包含已封闭项目，不能读取或发布统计');
}
export async function assertRuntimeReportPageProjects(db:Executor,projects:readonly string[]) {
 if(!projects.length)return;
 const closed=await db.execute(sql`SELECT project_id FROM observability.deletion_fences WHERE project_id IN (${sql.join(projects.map(id=>sql`${id}`),sql`,`)}) LIMIT 1`);
 if(closed.length)throw precondition('报告包含已封闭项目，不能读取或发布统计');
}
