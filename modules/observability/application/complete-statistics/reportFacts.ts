import {jsonHash} from '@crewstation/kernel';
import type {RuntimeReportHeader} from '@crewstation/contracts';
import type {CompleteRuntimeCohortBuild,CompleteRuntimeReportRow} from '../../ports/completeRuntimeCohort';
import type {CompleteWorkingRows} from '../../ports/completeWorkingRows';
import {completeRuntimeFactSummary,completeRuntimeFactRow} from '../../domain/completeReportFacts';
import {completeWorkingTraversal} from '../completeWorkingTraversal';
import {completeReportRows} from './reportRows';
/** Transform only a completed original cohort in the same reserved snapshot and TEMP workspace. */
export async function completeRuntimeFactBuild(input:{rows:CompleteWorkingRows;build:CompleteRuntimeCohortBuild;header:RuntimeReportHeader;signal?:AbortSignal}):Promise<CompleteRuntimeCohortBuild> {
 if(input.header.coverage!=='complete-facts'||input.build.summary.metrics.state!=='not-ready')throw new Error('Original complete execution facts require missing usage');
 const summary=completeRuntimeFactSummary(input.build.summary),output=completeReportRows({rows:input.rows,namespace:input.build.readyRowsNamespace+'/facts',keyOf:jsonHash,signal:input.signal});
 let tasks=0n;
 for await(const original of completeWorkingTraversal<CompleteRuntimeReportRow>(input.rows,input.build.readyRowsNamespace,input.signal)) {
  const row=completeRuntimeFactRow(original.document,summary.metrics.gaps);
  if(row){await output.append(row.section,row.parent,row.key,row.document);if(row.section==='tasks'&&row.parent===null)tasks++;}
 }
 if(String(tasks)!==summary.tasks)throw new Error('Original fact Task population changed');
 await output.finalizeCounts();
 return {...input.build,summary,readyRowsNamespace:output.namespace,countsNamespace:output.countsNamespace};
}
