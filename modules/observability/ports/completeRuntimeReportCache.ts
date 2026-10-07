import type {Actor,ProjectId,RuntimeStatisticsQuery,RuntimeCompleteReport,RuntimeReportPage,RuntimeReportPageQuery,TaskId} from '@crewstation/contracts';
export const runtimeReportAdmissionKey='observability.runtime-reports';
/** Frozen admission metadata for this immutable report; never a task population filter. */
export interface CompleteReportSourceCollection {readonly development:'validation-selected';readonly configurationDigest:string}
export interface CompleteReportRequest {readonly actor:Actor;readonly projectId:ProjectId|null;readonly filters:RuntimeStatisticsQuery;readonly taskId?:TaskId;readonly sourceCollection?:CompleteReportSourceCollection}
export interface CompleteReportStored {readonly id:string;readonly request:CompleteReportRequest;readonly requestKey:string;readonly owner:string;readonly state:'building'|'not-ready'|'failed'|'ready';readonly report:RuntimeCompleteReport}
export type {CompleteReportTransferItem,CompleteReportTransferPage,CompleteReportManifest} from '../domain/completeReportEnvelope';
import type {CompleteReportTransferItem,CompleteReportTransferPage,CompleteReportManifest} from '../domain/completeReportEnvelope';
export interface CompleteReportSpool {
 seal(identity:Pick<CompleteReportManifest,'reportId'|'buildOwner'|'requestKey'|'generation'|'sourceRevision'|'header'|'summary'|'sourceHeaders'>,items:AsyncIterable<CompleteReportTransferItem>,signal?:AbortSignal):Promise<CompleteReportManifest>;
 pages(manifest:CompleteReportManifest,signal?:AbortSignal):AsyncIterable<CompleteReportTransferPage>;
 remove(reportId:string,buildOwner:string):Promise<void>;
 clear():Promise<void>;
 empty():Promise<boolean>;
}
export interface CompleteRuntimeReportCache {
 identity():Promise<{generation:string;revision:string}>;
 ensure(request:CompleteReportRequest,requestKey:string,owner:string,id:string):Promise<CompleteReportStored>;
 get(id:string):Promise<CompleteReportStored|undefined>;
 hasVisibleTaskCosts(id:string):Promise<boolean>;
 claim(id:string,owner:string):Promise<CompleteReportStored>;
 renew(id:string,owner:string):Promise<boolean>;
 phase(id:string,owner:string,phase:string):Promise<void>;
 stage(id:string,owner:string,page:CompleteReportTransferPage):Promise<void>;
 publish(id:string,owner:string,manifest:CompleteReportManifest):Promise<void>;
 unavailable(id:string,owner:string,gaps:readonly {source:string;reason:string}[]):Promise<void>;
 fail(id:string,owner:string,error:string):Promise<void>;
 page<T>(report:CompleteReportStored,query:RuntimeReportPageQuery,after:string|null):Promise<RuntimeReportPage<T>>;
}
