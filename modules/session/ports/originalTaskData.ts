import type { ProjectDeletionContext, TaskId } from '@crewstation/contracts';
import type { BusinessExecutionStore } from './businessExecutions';
import type { BusinessUsageSourceStore } from './businessUsageSources';
import type { DevelopmentUsageSourceStore, DevelopmentUsageStore } from './developmentUsage';
import type { SessionDeletionScope } from './projectDeletion';

export interface SessionCleanupCopies {
  business: BusinessExecutionStore; businessSources: BusinessUsageSourceStore;
  development: DevelopmentUsageStore; developmentSources: DevelopmentUsageSourceStore;
}
export type SessionCleanupCopySelector = (context: ProjectDeletionContext, scope: SessionDeletionScope, taskId: TaskId) => Promise<{ taskKey: string; copies: SessionCleanupCopies }>;
