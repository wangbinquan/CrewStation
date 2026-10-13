import type { RuntimeFragment, RuntimePhase, NativeActivityEvent, RuntimePhaseTiming } from '@crewstation/contracts';
import type {CompleteTaskTiming} from '../domain/completeRuntimeTiming';
import type { CompleteUsageWorkspaceFactory } from './completeUsageWorkspace';
import type { RuntimeTaskHeaderFact,RuntimeAttemptFact} from '@crewstation/contracts';
import type { CompleteRuntimeFold,CompleteRuntimeMetrics } from '../domain/completeRuntimeMetrics';
import type { runtimeContributionEvidence } from '../domain/completeUsageEvidence';
import type { CompleteSourceReader,CompleteSourceReceipt } from './completeReport';
import type { CompleteRuntimeLedgerSources } from './completeRuntimeLedgerSources';
import type { CompleteWorkingRows } from './completeWorkingRows';

export interface CompleteAttemptWorking {
  readonly attempt:RuntimeAttemptFact;
  readonly fold:CompleteRuntimeFold;
  rawUsage:string;
  captures:string;
  nativeEmpty:boolean;
  nativeComplete:boolean;
}
export interface CompleteRuntimeTaskInput {
  readonly fragments?:CompleteSourceReader<RuntimeFragment>;
  readonly lifecycle?:readonly RuntimePhase[];
  readonly activity?:CompleteSourceReader<NativeActivityEvent>;
  readonly task:RuntimeTaskHeaderFact;
  readonly snapshotId:string;
  readonly asOf:string;
  readonly rows:CompleteWorkingRows;
  readonly namespace:string;
  readonly attempts:CompleteSourceReader<RuntimeAttemptFact>;
  readonly ledger:CompleteRuntimeLedgerSources;
  readonly keyOf:(value:string)=>string;
  readonly system:boolean;
  readonly usageWorkspace:CompleteUsageWorkspaceFactory;
  readonly signal?:AbortSignal;
}
export type CompleteRuntimeEvidence=ReturnType<typeof runtimeContributionEvidence>;
export type {CompleteRuntimeAllocation} from '../domain/runtime/completeRuntimeAllocation';

export interface CompleteRuntimeTaskBuild {
  readonly fragmentsNamespace?:string;
  readonly phaseTiming?:RuntimePhaseTiming;
  readonly phasesNamespace?:string;
  readonly projection?:{readonly capturedAt:string;readonly sourceRevision:string;readonly pending:boolean};
  readonly task:RuntimeTaskHeaderFact;
  readonly attemptCount:string;
  readonly fold:CompleteRuntimeFold;
  readonly metrics:CompleteRuntimeMetrics;
  readonly timing:CompleteTaskTiming;
  readonly sourceReceipts:readonly CompleteSourceReceipt[];
  readonly persistedThrough:string;
  readonly attemptsNamespace:string;
  readonly allocationsNamespace:string;
}
