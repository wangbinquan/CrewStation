import type { DevelopmentUsageKey, DevelopmentUsageLookup, DevelopmentUsagePage, ProjectDeletionContext, ProjectDeletionSessionData,
  RunnerBusinessReceipt, RunnerUsageSourcePage, TaskId } from '@crewstation/contracts';

export interface ObservationCleanupCopies {
  originalBusiness(after: string | null): Promise<RunnerBusinessReceipt[]>;
  offerBusiness(executionId: string): Promise<RunnerUsageSourcePage | null>;
  acknowledgeBusiness(executionId: string, through: number): Promise<void>;
  lookupDevelopmentUsage(taskId: TaskId): Promise<DevelopmentUsageLookup>;
  offerDevelopment(key: DevelopmentUsageKey): Promise<DevelopmentUsagePage | null>;
  acknowledgeDevelopment(key: DevelopmentUsageKey, through: number): Promise<void>;
  data(operation: ProjectDeletionSessionData): Promise<unknown>;
}
export interface ObservationCleanupBinding {
  (context: ProjectDeletionContext, taskId: TaskId): ObservationCleanupCopies;
  tasks(context: ProjectDeletionContext, after: TaskId | null): Promise<readonly TaskId[]>;
}
