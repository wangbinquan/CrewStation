import type { DevelopmentUsageDrainReason, DevelopmentUsageKey, DevelopmentUsageLookup, DevelopmentUsageRegistration, ProjectDeletionContext,
  ProjectDeletionSessionTransport, RunnerCommand, StoredDevelopmentUsage, TaskId } from '@crewstation/contracts';

/** Application sees existing numeric copies and original transports, independently of the HTTP client implementation. */
export interface SessionCleanupTask {
  transports(): Promise<ProjectDeletionSessionTransport[]>;
  send(transport: ProjectDeletionSessionTransport, command: RunnerCommand): Promise<unknown>;
  lookupDevelopmentUsage(taskId: TaskId): Promise<DevelopmentUsageLookup>;
  registerDevelopmentUsage(registration: DevelopmentUsageRegistration): Promise<StoredDevelopmentUsage>;
  getDevelopmentUsage(taskId: TaskId, key: DevelopmentUsageKey): Promise<StoredDevelopmentUsage>;
  requestDevelopmentUsageDrain(taskId: TaskId, key: DevelopmentUsageKey, reason: DevelopmentUsageDrainReason): Promise<StoredDevelopmentUsage>;
}
export type SessionCleanupBinding = (context: ProjectDeletionContext, taskId: TaskId) => SessionCleanupTask;
