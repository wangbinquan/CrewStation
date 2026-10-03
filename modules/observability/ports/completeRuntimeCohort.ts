import type {RuntimeFactQuery,RuntimeSourceKind,RuntimeCompleteSummary,RuntimeReportSection,CompleteRuntimeTaskSummary} from '@crewstation/contracts';
import type {CompleteRuntimeFold} from '../domain/completeRuntimeMetrics';
import type {CompleteRuntimeTaskBuild,CompleteRuntimeTaskInput} from './completeRuntimeTask';
import type {CompleteSourceReceipt} from './completeReport';
import type {CompleteRuntimeFactSources} from './completeRuntimeFactSources';
export interface CompleteRuntimeReportRow {readonly section:RuntimeReportSection;readonly parent:string|null;readonly key:string;readonly document:unknown}
export interface CompleteDimensionWorking {readonly key:string;readonly metadata:Readonly<Record<string,unknown>>;readonly fold:CompleteRuntimeFold;count:string}
export interface CompleteRuntimeCohortInput extends Pick<CompleteRuntimeTaskInput,'snapshotId'|'asOf'|'rows'|'namespace'|'keyOf'|'system'|'usageWorkspace'|'signal'> {
  readonly query:RuntimeFactQuery;
  readonly facts:CompleteRuntimeFactSources;
  task(task:Parameters<CompleteRuntimeFactSources['attempts']>[0],namespace:string):Promise<CompleteRuntimeTaskBuild>;
}
export interface CompleteRuntimeCohortBuild {
  readonly summary:RuntimeCompleteSummary;
  readonly fold:CompleteRuntimeFold;
  readonly sourceReceipts:readonly CompleteSourceReceipt[];
  readonly readyRowsNamespace:string;
  readonly countsNamespace:string;
  readonly receiptsNamespace:string;
}
export interface CompleteCohortTask {readonly build:CompleteRuntimeTaskBuild;readonly summary:CompleteRuntimeTaskSummary;readonly sourceKind:RuntimeSourceKind}
