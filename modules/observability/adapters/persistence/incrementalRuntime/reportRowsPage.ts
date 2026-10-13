import {sql} from 'drizzle-orm';
import type {Executor} from '@crewstation/persistence';
import type {RuntimeReportPageQuery} from '@crewstation/contracts';
const taskSections=new Set(['attempts','swimlane','calls','phases','fragments']);
/** Seek the ordered task references first. A large task's first page never sorts every report row across the whole population. */
export async function readPinnedRowsPage(tx:Executor,id:string,q:RuntimeReportPageQuery,position:readonly [string,string]){
 const task=q.parent&&taskSections.has(q.section)?q.parent:undefined,owner=sql`r.report_id=${id} AND ${task?sql`r.task_id=${task}`:sql`true`}`;
 const [count]=await tx.execute(q.rowKey?sql`SELECT count(*)::text AS total FROM observability.runtime_report_task_views r JOIN LATERAL observability.runtime_view_rows(r.task_id,r.version,(r.document->>'rowThrough')::numeric,'public-rows') v ON true WHERE ${owner} AND v.document->>'section'=${q.section} AND coalesce(v.document->>'parent','')=${q.parent??''} AND v.document->>'key'=${q.rowKey}`:sql`SELECT coalesce(sum((v.document->>'total')::numeric),0)::text AS total FROM observability.runtime_report_task_views r JOIN LATERAL observability.runtime_view_rows(r.task_id,r.version,(r.document->>'rowThrough')::numeric,'public-counts') v ON true WHERE ${owner} AND v.document->>'section'=${q.section} AND coalesce(v.document->>'parent','')=${q.parent??''}`);
 const result:Array<{ordinal:string;key:string;document:unknown}>=[];let ordinal=position[0],at=position[1],include=true;
 for(;;){const refs=await tx.execute(sql`SELECT r.ordinal::text,r.task_id,r.version,r.document FROM observability.runtime_report_task_views r WHERE ${owner} AND ${include?sql`r.ordinal>=${ordinal}::bigint`:sql`r.ordinal>${ordinal}::bigint`} ORDER BY r.ordinal LIMIT 200`);if(!refs.length)break;
  for(const ref of refs){const here=String(ref['ordinal']),after=here===ordinal?at:'',rows=await tx.execute(sql`SELECT key,document FROM observability.runtime_view_rows(${String(ref['task_id'])},${ref['version']===null?null:String(ref['version'])},${(ref['document'] as {rowThrough?:string}).rowThrough??null}::numeric,'public-rows') WHERE key>${after} AND document->>'section'=${q.section} AND coalesce(document->>'parent','')=${q.parent??''} AND ${q.rowKey?sql`document->>'key'=${q.rowKey}`:sql`true`} ORDER BY key LIMIT ${q.pageSize+1-result.length}`);for(const row of rows)result.push({ordinal:here,key:String(row['key']),document:row['document']});if(result.length>q.pageSize){const shown=result.slice(0,q.pageSize),last=shown.at(-1)!;return {rows:shown,total:String(count?.['total']??'0'),nextCursor:JSON.stringify([last.ordinal,last.key])};}ordinal=here;at='';include=false;
  }
 }
 return {rows:result,total:String(count?.['total']??'0'),nextCursor:null};
}
