import type { UsageNativeCapture, UsageRecord, UsageValuation, RuntimeNativePagedCapture } from '@crewstation/contracts';
import type { CompleteSourceReader } from './completeReport';
/** Independent true-EOF sources from one original Executor; valuations never share a usage budget. */
export interface CompleteRuntimeLedgerSources {
  readonly snapshotId: string;
  readonly usage: CompleteSourceReader<UsageRecord>;
  readonly valuations: CompleteSourceReader<UsageValuation>;
  readonly captures: CompleteSourceReader<UsageNativeCapture>;
  readonly pagedCaptures?: CompleteSourceReader<RuntimeNativePagedCapture>;
  costVisible(): Promise<boolean>;
  persistedThrough(): Promise<string>;
}
