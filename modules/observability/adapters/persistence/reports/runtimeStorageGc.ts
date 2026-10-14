import {sql} from 'drizzle-orm';
import type {Database,Executor} from '@crewstation/persistence';
import {runtimeReportAdmissionKey} from '../../../ports/completeRuntimeReportCache';
/** Batches are scheduling units. Cursors wrap at EOF; there is no population limit. */
async function retire(db:Executor) {
 await db.execute(sql`WITH expired AS(SELECT l.id FROM observability.runtime_report_leases l WHERE NOT l.retiring AND l.expires_at<clock_timestamp() AND NOT EXISTS(SELECT 1 FROM observability.runtime_reports r WHERE r.id=l.id AND r.state='building' AND r.lease_until>clock_timestamp()) ORDER BY l.expires_at,l.id LIMIT 100) UPDATE observability.runtime_report_leases l SET retiring=true FROM expired x WHERE l.id=x.id`);
 await db.execute(sql`UPDATE observability.runtime_lazy_reports r SET request_key='retired/'||r.id FROM observability.runtime_report_leases l WHERE l.id=r.id AND l.retiring AND r.request_key<>'retired/'||r.id`);
 await db.execute(sql`UPDATE observability.runtime_reports r SET request_key='retired/'||r.id FROM observability.runtime_report_leases l WHERE l.id=r.id AND l.retiring AND r.request_key<>'retired/'||r.id`);
 let removed=0;
 // Exact derived allowlist. Never accept a caller-supplied table name.
 for(const table of ['runtime_report_task_refs','runtime_report_rows','runtime_report_pages','runtime_report_counts','runtime_report_receipts'] as const){
  const target=sql`${sql.identifier('observability')}.${sql.identifier(table)}`;
  const rows=await db.execute(sql`DELETE FROM ${target} WHERE ctid IN(SELECT r.ctid FROM ${target} r JOIN observability.runtime_report_leases l ON l.id=r.report_id WHERE l.retiring LIMIT 500) RETURNING 1`);removed+=rows.length;
 }
 await db.execute(sql`DELETE FROM observability.runtime_lazy_reports r USING observability.runtime_report_leases l WHERE l.id=r.id AND l.retiring AND NOT EXISTS(SELECT 1 FROM observability.runtime_report_task_refs x WHERE x.report_id=r.id)`);
 await db.execute(sql`DELETE FROM observability.runtime_reports r USING observability.runtime_report_leases l WHERE l.id=r.id AND l.retiring AND NOT EXISTS(SELECT 1 FROM observability.runtime_report_rows x WHERE x.report_id=r.id) AND NOT EXISTS(SELECT 1 FROM observability.runtime_report_pages x WHERE x.report_id=r.id) AND NOT EXISTS(SELECT 1 FROM observability.runtime_report_counts x WHERE x.report_id=r.id) AND NOT EXISTS(SELECT 1 FROM observability.runtime_report_receipts x WHERE x.report_id=r.id)`);
 await db.execute(sql`DELETE FROM observability.runtime_report_leases l WHERE l.retiring AND NOT EXISTS(SELECT 1 FROM observability.runtime_lazy_reports r WHERE r.id=l.id) AND NOT EXISTS(SELECT 1 FROM observability.runtime_reports r WHERE r.id=l.id)`);
 const docs=await db.execute(sql`DELETE FROM observability.runtime_report_task_documents WHERE key IN(SELECT d.key FROM observability.runtime_report_task_documents d WHERE NOT EXISTS(SELECT 1 FROM observability.runtime_report_task_refs r WHERE r.document_key=d.key) ORDER BY d.key LIMIT 500) RETURNING 1`);
 return removed+docs.length;
}
async function history(db:Executor,cursor:unknown,onScanned?:(rows:number)=>void) {
 const at=Array.isArray(cursor)?cursor.map(String):['','','','0'];
 const rows=await db.execute(sql`SELECT task_id,role,key,sequence::text FROM observability.runtime_task_row_history WHERE (task_id,role,key,sequence)>(${at[0]!},${at[1]!},${at[2]!},${at[3]!}::numeric) ORDER BY task_id,role,key,sequence LIMIT 500`);
 onScanned?.(rows.length);
 if(!rows.length){await db.execute(sql`UPDATE observability.runtime_storage_guard SET history_cursor=NULL WHERE singleton=true`);return 0;}
 const last=rows.at(-1)!,end=[String(last['task_id']),String(last['role']),String(last['key']),String(last['sequence'])];
 // Each retained watermark protects its own preceding anchor. An old report must not pin every later revision.
 // The next sequence is an indexed lookup per candidate; reference relations remain searchable by task_id.
 const removed=await db.execute(sql`WITH candidates AS MATERIALIZED(
 SELECT h.task_id,h.role,h.key,h.sequence,(SELECT n.sequence FROM observability.runtime_task_row_history n WHERE n.task_id=h.task_id AND n.role=h.role AND n.key=h.key AND n.sequence>h.sequence ORDER BY n.sequence LIMIT 1) AS next_sequence
 FROM observability.runtime_task_row_history h WHERE (h.task_id,h.role,h.key,h.sequence)>(${at[0]!},${at[1]!},${at[2]!},${at[3]!}::numeric) AND (h.task_id,h.role,h.key,h.sequence)<=(${end[0]!},${end[1]!},${end[2]!},${end[3]!}::numeric)
 ) DELETE FROM observability.runtime_task_row_history h USING candidates c WHERE h.task_id=c.task_id AND h.role=c.role AND h.key=c.key AND h.sequence=c.sequence AND c.next_sequence IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM observability.runtime_task_work w WHERE w.key=c.task_id)
 AND NOT EXISTS(SELECT 1 FROM observability.runtime_task_cache p WHERE p.task_id=c.task_id AND (p.document->>'rowThrough')::numeric>=c.sequence AND (p.document->>'rowThrough')::numeric<c.next_sequence)
 AND NOT EXISTS(SELECT 1 FROM observability.runtime_report_task_views p WHERE p.task_id=c.task_id AND (p.document->>'rowThrough')::numeric>=c.sequence AND (p.document->>'rowThrough')::numeric<c.next_sequence)
 AND NOT EXISTS(SELECT 1 FROM observability.runtime_maintenance_members p WHERE p.task_id=c.task_id AND p.state='pending' AND p.row_through>=c.sequence AND p.row_through<c.next_sequence) RETURNING 1`);
 await db.execute(sql`UPDATE observability.runtime_storage_guard SET history_cursor=${JSON.stringify(end)}::jsonb WHERE singleton=true`);return removed.length;
}
async function cache(db:Executor,cursor:unknown,onScanned?:(rows:number)=>void) {
 const at=Array.isArray(cursor)?cursor.map(String):['','','',''];
 const rows=await db.execute(sql`SELECT task_id,version,role,key FROM observability.runtime_task_cache_rows WHERE (task_id,version,role,key)>(${at[0]!},${at[1]!},${at[2]!},${at[3]!}) ORDER BY task_id,version,role,key LIMIT 500`);
 onScanned?.(rows.length);
 if(!rows.length){await db.execute(sql`UPDATE observability.runtime_storage_guard SET cache_cursor=NULL WHERE singleton=true`);return 0;}
 const last=rows.at(-1)!,end=['task_id','version','role','key'].map(k=>String(last[k]));
 const removed=await db.execute(sql`DELETE FROM observability.runtime_task_cache_rows r WHERE (r.task_id,r.version,r.role,r.key)>(${at[0]!},${at[1]!},${at[2]!},${at[3]!}) AND (r.task_id,r.version,r.role,r.key)<=(${end[0]!},${end[1]!},${end[2]!},${end[3]!}) AND NOT EXISTS(SELECT 1 FROM observability.runtime_task_cache c WHERE c.task_id=r.task_id AND c.version=r.version) AND NOT EXISTS(SELECT 1 FROM observability.runtime_report_task_refs p WHERE p.task_id=r.task_id AND p.version=r.version) AND NOT EXISTS(SELECT 1 FROM observability.runtime_maintenance_members m WHERE m.task_id=r.task_id AND m.version=r.version AND m.state='pending') AND NOT EXISTS(SELECT 1 FROM observability.runtime_task_work w WHERE w.key=r.task_id) RETURNING 1`);
 await db.execute(sql`UPDATE observability.runtime_storage_guard SET cache_cursor=${JSON.stringify(end)}::jsonb WHERE singleton=true`);return removed.length;
}
export async function collectRuntimeStorage(db:Database,onScanned?:(rows:number)=>void) {
 let scanned=0;const removed=await db.transaction(async tx=>{
  const [lock]=await tx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${runtimeReportAdmissionKey},0)) AS acquired`);if(lock?.['acquired']!==true)return 0;
  const [state]=await tx.execute(sql`UPDATE observability.runtime_storage_guard SET generation=generation+1 WHERE singleton=true RETURNING history_cursor,cache_cursor`);
  let removed=await retire(tx);removed+=await history(tx,state?.['history_cursor'],rows=>{scanned+=rows;});removed+=await cache(tx,state?.['cache_cursor'],rows=>{scanned+=rows;});
  // Count committed rows atomically. A late committing insert remains in the notification table.
  const compacted=await tx.execute(sql`WITH removed AS(DELETE FROM observability.runtime_report_revisions WHERE revision IN(SELECT revision FROM observability.runtime_report_revisions ORDER BY revision LIMIT 1000) RETURNING revision),n AS(SELECT count(*) AS total FROM removed) UPDATE observability.runtime_report_clock SET revision=revision+n.total FROM n WHERE singleton=true RETURNING n.total::text AS total`);
  removed+=Number(compacted[0]?.['total']??0);
  const publications=await tx.execute(sql`DELETE FROM observability.runtime_task_publications WHERE revision IN(SELECT revision FROM observability.runtime_task_publications ORDER BY revision LIMIT 1000) RETURNING revision`);removed+=publications.length;
  await tx.execute(sql`UPDATE observability.runtime_storage_guard SET last_success=clock_timestamp(),last_error=NULL,reclaimed=reclaimed+${removed} WHERE singleton=true`);
  return removed;
 });
 onScanned?.(scanned);return removed;
}
