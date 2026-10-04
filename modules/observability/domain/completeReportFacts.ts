import {RUNTIME_REPORT_FACT_SECTIONS,RuntimeCompleteFactSummarySchema,CompleteRuntimeGapMetricsSchema,type RuntimeCompleteSummary} from '@crewstation/contracts';
import type {CompleteReportOutputRow,CompleteReportTransferItem} from './completeReportEnvelope';
/** Numeric gaps apply to every child layer; original Task, attempt and time facts remain intact. */
export function completeRuntimeFactSummary(summary:RuntimeCompleteSummary) {
 if(summary.metrics.state!=='not-ready')throw new Error('Original fact summary requires incomplete usage');
 const metrics=summary.metrics;
 return RuntimeCompleteFactSummarySchema.parse({...summary,trend:summary.trend.map(row=>({...row,metrics})),sources:summary.sources.map(row=>({...row,metrics}))});
}
export function completeRuntimeFactRow(row:CompleteReportOutputRow,gaps:readonly string[]):CompleteReportOutputRow|null {
 if(!RUNTIME_REPORT_FACT_SECTIONS.includes(row.section))return null;
 if(!row.document||typeof row.document!=='object'||Array.isArray(row.document))throw new Error('Original fact row malformed');
 const document=row.document as Record<string,unknown>;
 if(row.section!=='quality'&&!('metrics' in document))throw new Error('Original fact row metrics missing');
 return {...row,document:'metrics' in document?{...document,metrics:{state:'not-ready',gaps}}:document};
}
export function assertCompleteRuntimeFactItem(item:CompleteReportTransferItem) {
 if(item.kind==='receipt')return;
 const section=item.kind==='row'?item.row.section:item.section;
 if(!RUNTIME_REPORT_FACT_SECTIONS.includes(section))throw new Error('Incomplete usage cannot publish numeric collections');
 if(item.kind==='row') {
  const document=item.row.document as Record<string,unknown>;
  if(!document||typeof document!=='object'||Array.isArray(document))throw new Error('Original fact row malformed');
  if((section!=='quality'||'metrics' in document)&&!CompleteRuntimeGapMetricsSchema.safeParse(document['metrics']).success)throw new Error('Incomplete usage cannot expose child subtotals');
 }
}
