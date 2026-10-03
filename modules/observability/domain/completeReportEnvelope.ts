import {jsonHash} from '@crewstation/kernel';
import type {RuntimeReportHeader,RuntimeCompleteSummary,RuntimeReportSection} from '@crewstation/contracts';
export interface CompleteReportOutputRow {readonly section:RuntimeReportSection;readonly parent:string|null;readonly key:string;readonly document:unknown}
export type CompleteReportTransferItem={readonly kind:'row';readonly row:CompleteReportOutputRow}|{readonly kind:'count';readonly section:RuntimeReportSection;readonly parent:string|null;readonly total:string}|{readonly kind:'receipt';readonly key:string;readonly document:unknown};
export interface CompleteReportTransferPage {readonly reportId:string;readonly ordinal:string;readonly previousDigest:string;readonly digest:string;readonly items:readonly CompleteReportTransferItem[]}
export interface CompleteReportManifest {readonly reportId:string;readonly buildOwner:string;readonly requestKey:string;readonly generation:string;readonly sourceRevision:string;readonly pages:string;readonly rows:string;readonly counts:string;readonly receipts:string;readonly digest:string;readonly header:RuntimeReportHeader;readonly summary:RuntimeCompleteSummary;readonly sourceHeaders:unknown}

export const completeReportInitialDigest=jsonHash(['complete-runtime-report',2]);
export function completeReportTransferPage(reportId:string,ordinal:string,previousDigest:string,items:readonly CompleteReportTransferItem[]):CompleteReportTransferPage {
 if(!/^(0|[1-9]\d*)$/.test(ordinal)||items.length<1||items.length>500)throw new Error('Complete report transfer page malformed');
 return {reportId,ordinal,previousDigest,items,digest:jsonHash({reportId,ordinal,previousDigest,items})};
}
export function assertCompleteReportTransferPage(page:CompleteReportTransferPage,reportId:string,ordinal:string,previousDigest:string) {
 if(page.reportId!==reportId||page.ordinal!==ordinal||page.previousDigest!==previousDigest||page.digest!==completeReportTransferPage(reportId,ordinal,previousDigest,page.items).digest)throw new Error('Complete report transfer page identity or digest changed');
}
export function assertCompleteReportManifest(actual:{pages:bigint;rows:bigint;counts:bigint;receipts:bigint;digest:string},manifest:CompleteReportManifest) {
 for(const key of ['pages','rows','counts','receipts'] as const)if(String(actual[key])!==manifest[key])throw new Error('Complete report sealed population is incomplete: '+key);
 if(actual.digest!==manifest.digest)throw new Error('Complete report sealed digest changed');
}
