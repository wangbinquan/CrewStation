import {sql} from 'drizzle-orm';
import {jsonHash} from '@crewstation/kernel';
import type {Executor} from '@crewstation/persistence';
import {RUNTIME_REPORT_FACT_SECTIONS,runtimeCompleteReportContent,type RuntimeCompleteReport} from '@crewstation/contracts';
import type {CompleteReportManifest} from '../../../ports/completeRuntimeReportCache';
import {completeReportInitialDigest} from '../../../domain/completeReportEnvelope';
/** Reuse the original publication population checks before exposing any retained report. */
export async function assertPublishedRuntimeReport(db:Executor,id:string,report:RuntimeCompleteReport,manifest:CompleteReportManifest|null) {
 const content=runtimeCompleteReportContent(report);if(!content)return;
 if(!manifest||manifest.reportId!==id||content.header.reportId!==id||content.header.generation!==manifest.generation||content.header.snapshotId!==manifest.header.snapshotId||jsonHash(manifest.header)!==jsonHash(content.header)||jsonHash(manifest.summary)!==jsonHash(content.summary))throw new Error('Original published report manifest changed');
 const [pop]=await db.execute(sql`SELECT (SELECT count(*)::text FROM observability.runtime_report_pages WHERE report_id=${id}) AS pages,(SELECT count(*)::text FROM observability.runtime_report_rows WHERE report_id=${id}) AS rows,(SELECT count(*)::text FROM observability.runtime_report_counts WHERE report_id=${id}) AS counts,(SELECT count(*)::text FROM observability.runtime_report_receipts WHERE report_id=${id}) AS receipts`);
 for(const key of ['pages','rows','counts','receipts'] as const)if(String(pop?.[key])!==manifest[key])throw new Error('Complete report staged population missing: '+key);
 const [tail]=await db.execute(sql`SELECT digest FROM observability.runtime_report_pages WHERE report_id=${id} ORDER BY ordinal DESC LIMIT 1`);
 if((tail?.['digest']??completeReportInitialDigest)!==manifest.digest)throw new Error('Complete report staged final digest changed');
 const mismatch=await db.execute(sql`WITH actual AS(SELECT section,parent,count(*) AS total FROM observability.runtime_report_rows WHERE report_id=${id} GROUP BY section,parent),expected AS(SELECT section,parent,total FROM observability.runtime_report_counts WHERE report_id=${id}) SELECT * FROM ((SELECT * FROM actual EXCEPT SELECT * FROM expected) UNION ALL (SELECT * FROM expected EXCEPT SELECT * FROM actual)) d LIMIT 1`);
 if(mismatch.length)throw new Error('Complete report dimension population does not match original sealed counts');
 const taskCount=await db.execute(sql`SELECT total::text FROM observability.runtime_report_counts WHERE report_id=${id} AND section='tasks' AND parent=''`);
 if(String(taskCount[0]?.['total']??'0')!==manifest.summary.tasks||manifest.receipts!==manifest.summary.tasks)throw new Error('Complete report original task EOF count changed');
 if(content.header.coverage==='complete-facts') {
  const sections=sql.join(RUNTIME_REPORT_FACT_SECTIONS.map(section=>sql`${section}`),sql`,`),invalid=await db.execute(sql`SELECT 1 FROM observability.runtime_report_rows WHERE report_id=${id} AND (section NOT IN (${sections}) OR ((section<>'quality' OR document ? 'metrics') AND COALESCE(document->'metrics'->>'state','') NOT IN ('ready','not-applicable') AND (COALESCE(document->'metrics'->>'state','')<>'not-ready' OR document->'metrics' ? 'tokens' OR document->'metrics' ? 'cost'))) LIMIT 1`);
  if(invalid.length)throw new Error('Incomplete usage cannot publish child subtotals or numeric collections');
 }
}
