import type { DevelopmentUsageLookup, ProjectDeletionContext, ProjectDeletionSessionTransport, RunnerBusinessReceipt, RunnerCommand, TaskId } from '@crewstation/contracts';

export interface RuntimeSessionCopies {
  originalBusiness(after?: string | null): Promise<RunnerBusinessReceipt[]>;
  transports(): Promise<ProjectDeletionSessionTransport[]>;
  send(transport: ProjectDeletionSessionTransport, command: RunnerCommand): Promise<unknown>;
  lookupDevelopmentUsage(taskId: TaskId): Promise<DevelopmentUsageLookup>;
  getBusinessExecution(taskId: TaskId, executionId: string): Promise<{ receipt: RunnerBusinessReceipt; persistedThrough: number; acknowledgedThrough: number; complete: boolean } | undefined>;
}
export type RuntimeSessionBinding = (context: ProjectDeletionContext, taskId: TaskId) => RuntimeSessionCopies;
