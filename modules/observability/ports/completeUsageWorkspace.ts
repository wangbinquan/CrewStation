import type { UsageContributionEvidence } from '../domain/completeUsageEvidence'
import type { TokenUsage } from '../domain/tokenUsage'
import type { CoverageIntervalStore } from '../domain/coverageIntervalIndex'
import type { CompleteWorkingRows } from './completeWorkingRows'

export interface CompleteUsageWorkspace<T extends UsageContributionEvidence> {
  readonly coverage: CoverageIntervalStore
  /** Replay the fully retained input to validate all ancestry before allocating any bucket. */
  records(): AsyncIterable<T>
  /** Original JS localeCompare ordering, externally merged; no SQL collation substitution. */
  orderedRecords(): AsyncIterable<T>
  /** Same group/session with a different full path must fail. */
  bindAncestry(group: string, session: string, ancestors: readonly string[]): Promise<void>
  /** Output is derived allocation only; never a usage-ledger revision. */
  allocate(
    record: T,
    contribution: TokenUsage,
    quality: { ambiguous: boolean; unavailable: boolean },
  ): Promise<void>
}

export interface CompleteUsageRetention<T extends UsageContributionEvidence> {
  readonly workspace:CompleteUsageWorkspace<T>;
  append(items:readonly T[]):Promise<void>;
  seal(expectedRows:string):void;
  flush():Promise<void>;
  readonly allocationsNamespace:string;
}
export interface CompleteUsageRetentionInput<T extends UsageContributionEvidence> {
  readonly rows:CompleteWorkingRows;
  readonly namespace:string;
  readonly keyOf:(value:string)=>string;
  readonly identity:(record:T)=>string;
  readonly signal?:AbortSignal;
}
export type CompleteUsageWorkspaceFactory=<T extends UsageContributionEvidence>(input:CompleteUsageRetentionInput<T>)=>CompleteUsageRetention<T>;
export type CompleteUsageOrdering<T>= (input:{ readonly workspace:CompleteWorkingRows;readonly namespace:string;readonly records:AsyncIterable<T>;readonly compare:(a:T,b:T)=>number;readonly signal?:AbortSignal })=>Promise<{records():AsyncIterable<T>}>;
