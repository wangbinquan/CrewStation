import {sql} from 'drizzle-orm';
import type {Executor} from '@crewstation/persistence';
import type {RuntimeReportPage,RuntimeReportPageQuery} from '@crewstation/contracts';
import type {CompleteReportStored} from '../../../ports/completeRuntimeReportCache';
/** Seek and count only in a published immutable full report. Never sum the current response page. */
export async function completeRuntimeReportPage<T>(db:Executor,report:CompleteReportStored,query:RuntimeReportPageQuery,after:string|null):Promise<RuntimeReportPage<T>> {
 if(report.report.state!=='ready')throw new Error('Full runtime report is not ready');
 const parent=query.parent??'',header=report.report.header;
 const [published]=await db.execute(sql`SELECT report FROM observability.runtime_reports WHERE id=${report.id} AND state='ready'`);if(!published)throw new Error('Published complete report no longer available');
 const predicate=sql`report_id=${report.id} AND section=${query.section} AND parent=${parent} AND ${query.rowKey?sql`key=${query.rowKey}`:sql`true`}`;
 const [count]=await db.execute(query.rowKey?sql`SELECT count(*)::text AS total FROM observability.runtime_report_rows WHERE ${predicate}`:sql`SELECT total::text FROM observability.runtime_report_counts WHERE report_id=${report.id} AND section=${query.section} AND parent=${parent}`);
 const rows=await db.execute(sql`SELECT ordinal::text,document FROM observability.runtime_report_rows WHERE ${predicate} AND ${after===null?sql`true`:sql`ordinal>${after}::numeric`} ORDER BY observability.runtime_report_rows.ordinal LIMIT ${query.pageSize+1}`);
 const items=rows.slice(0,query.pageSize);
 return {reportId:report.id,snapshotId:header.snapshotId,section:query.section,parent:query.parent??null,total:String(count?.['total']??'0'),items:items.map(row=>row['document'] as T),nextCursor:rows.length>query.pageSize?String(items.at(-1)!['ordinal']):null};
}
