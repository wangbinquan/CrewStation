import {sql} from 'drizzle-orm';
import type {Executor} from '@crewstation/persistence';
import {runtimeCompleteReportContent,RUNTIME_REPORT_NATIVE_FACT_SECTIONS,RuntimeCompleteReportSchema,type RuntimeReportPage,type RuntimeReportPageQuery} from '@crewstation/contracts';
import type {CompleteReportStored,CompleteReportManifest} from '../../../ports/completeRuntimeReportCache';
import {assertPublishedRuntimeReport} from './reportIntegrity';
import {assertCompleteRuntimeFactItem} from '../../../domain/completeReportFacts';
/** Seek and count only in a published immutable full report. Never sum the current response page. */
export async function completeRuntimeReportPage<T>(db:Executor,report:CompleteReportStored,query:RuntimeReportPageQuery,after:string|null):Promise<RuntimeReportPage<T>> {
 const content=runtimeCompleteReportContent(report.report);if(!content)throw new Error('Full runtime report is not ready');
 if(content.header.coverage==='complete-facts'&&!RUNTIME_REPORT_NATIVE_FACT_SECTIONS.includes(query.section))throw new Error('Incomplete usage cannot read numeric collections');
 const parent=query.parent??'',header=content.header;
 const [published]=await db.execute(sql`SELECT report,manifest FROM observability.runtime_reports WHERE id=${report.id} AND state=${report.report.state}`);if(!published||JSON.stringify(RuntimeCompleteReportSchema.parse(published['report']))!==JSON.stringify(report.report))throw new Error('Published complete report no longer available');
 await assertPublishedRuntimeReport(db,report.id,report.report,published['manifest'] as CompleteReportManifest|null);
 const predicate=sql`report_id=${report.id} AND section=${query.section} AND parent=${parent} AND ${query.rowKey?sql`key=${query.rowKey}`:sql`true`}`;
 const [count]=await db.execute(query.rowKey?sql`SELECT count(*)::text AS total FROM observability.runtime_report_rows WHERE ${predicate}`:sql`SELECT total::text FROM observability.runtime_report_counts WHERE report_id=${report.id} AND section=${query.section} AND parent=${parent}`);
 const rows=await db.execute(sql`SELECT ordinal::text,key,document FROM observability.runtime_report_rows WHERE ${predicate} AND ${after===null?sql`true`:sql`ordinal>${after}::numeric`} ORDER BY observability.runtime_report_rows.ordinal LIMIT ${query.pageSize+1}`);
 const items=rows.slice(0,query.pageSize);
 if(header.coverage==='complete-facts')for(const row of items)assertCompleteRuntimeFactItem({kind:'row',row:{section:query.section,parent:query.parent??null,key:String(row['key']),document:row['document']}});
 return {reportId:report.id,snapshotId:header.snapshotId,section:query.section,parent:query.parent??null,total:String(count?.['total']??'0'),items:items.map(row=>row['document'] as T),nextCursor:rows.length>query.pageSize?String(items.at(-1)!['ordinal']):null};
}
