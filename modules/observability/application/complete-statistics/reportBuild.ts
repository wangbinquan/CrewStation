import type {RuntimeReportHeader} from '@crewstation/contracts';
import type {CompleteRuntimeCohortBuild} from '../../ports/completeRuntimeCohort';
import type {CompleteWorkingRows} from '../../ports/completeWorkingRows';
import type {CompleteReportTransferItem,CompleteReportSpool} from '../../ports/completeRuntimeReportCache';
import {completeWorkingTraversal} from '../completeWorkingTraversal';
import type {CompleteRuntimeReportRow} from '../../ports/completeRuntimeCohort';
import type {CompleteReportCount} from './reportRows';
import {completeRuntimeFactBuild} from './reportFacts';
export async function sealCompleteRuntimeReport(input:{rows:CompleteWorkingRows;build:CompleteRuntimeCohortBuild;spool:CompleteReportSpool;header:RuntimeReportHeader;buildOwner:string;requestKey:string;signal?:AbortSignal}) {
 const build=input.header.coverage==='complete-facts'?await completeRuntimeFactBuild(input):input.build;
 const items=async function*():AsyncGenerator<CompleteReportTransferItem> {
  for await(const row of completeWorkingTraversal<CompleteRuntimeReportRow>(input.rows,build.readyRowsNamespace,input.signal))yield {kind:'row',row:row.document};
  for await(const row of completeWorkingTraversal<CompleteReportCount>(input.rows,build.countsNamespace,input.signal))yield {kind:'count',...row.document};
  for await(const row of completeWorkingTraversal(input.rows,build.receiptsNamespace,input.signal))yield {kind:'receipt',key:row.key,document:row.document};
 };
 return input.spool.seal({reportId:input.header.reportId,buildOwner:input.buildOwner,requestKey:input.requestKey,generation:input.header.generation,sourceRevision:input.header.sourceRevision,header:input.header,summary:build.summary,sourceHeaders:build.sourceReceipts},items(),input.signal);
}
