import type {UsageRecord,UsageValuation,RunnerUsageMeasurement} from '@crewstation/contracts';
import type {runtimeContributionEvidence} from '../completeUsageEvidence';
type CompleteRuntimeEvidence=ReturnType<typeof runtimeContributionEvidence>;
export interface CompleteRuntimeAllocation {
  readonly actualModel?:RunnerUsageMeasurement['actualModel'];
  readonly record:CompleteRuntimeEvidence;
  readonly contribution:UsageRecord['usage'];
  readonly quality:{readonly ambiguous:boolean;readonly unavailable:boolean};
  readonly valuation?:UsageValuation|null;
  readonly whole?:boolean;
}
