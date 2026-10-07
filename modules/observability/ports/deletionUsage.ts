import type { DevelopmentNativePageEvidence, DevelopmentUsageKey, DevelopmentUsageLookup, DevelopmentUsagePage, DevelopmentUsageRegistration, ProjectDeletionContext, RunnerBusinessReceipt,
  RunnerUsageMeasurement, RunnerUsageSourceIdentity, RunnerUsageSourcePage, TaskId, UsageExecutionIdentity } from '@crewstation/contracts';
import type { DevelopmentUsageResolved } from './developmentUsage';
import type { UsageSourcePage } from './usageLedger';

export interface ObservationOriginalTask {
  originalBusiness(after: string | null): Promise<RunnerBusinessReceipt[]>;
  offerBusiness(executionId: string): Promise<RunnerUsageSourcePage | null>;
  acknowledgeBusiness(executionId: string, through: number): Promise<void>;
  businessMeasurement(page: RunnerUsageSourceIdentity, recordId: string, revision: number): Promise<RunnerUsageMeasurement | undefined>;
  lookupDevelopmentUsage(taskId: TaskId): Promise<DevelopmentUsageLookup>;
  offerDevelopment(key: DevelopmentUsageKey): Promise<DevelopmentUsagePage | null>;
  acknowledgeDevelopment(key: DevelopmentUsageKey, through: number): Promise<void>;
  nativeDevelopmentPage?(key: DevelopmentUsageKey, passId: string, ordinal: string): Promise<DevelopmentNativePageEvidence>;
}
export interface ObservationOriginalUsage {
  tasks(context: ProjectDeletionContext, after: TaskId | null): Promise<readonly TaskId[]>;
  task(context: ProjectDeletionContext, id: TaskId): Promise<ObservationOriginalTask>;
  business(page: RunnerUsageSourcePage): Promise<UsageExecutionIdentity | undefined>;
  development(key: DevelopmentUsageKey): Promise<DevelopmentUsageResolved | undefined>;
}
export interface ObservationDeletionWriter {
  business(context: ProjectDeletionContext, original: ObservationOriginalTask, source: RunnerUsageSourcePage, page: UsageSourcePage): Promise<void>;
  development(context: ProjectDeletionContext, source: DevelopmentUsagePage, owner: DevelopmentUsageResolved,
    registration: DevelopmentUsageRegistration, original?: ObservationOriginalTask): Promise<void>;
  developmentPending?(context: ProjectDeletionContext, registration: DevelopmentUsageRegistration, original: ObservationOriginalTask): Promise<void>;
}
