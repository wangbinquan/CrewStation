import type { ProjectDeletionContext, TaskId } from '@crewstation/contracts';
import type { TaskEnvironment } from '../../domain/taskEnvironment';
import type { DevelopmentCleanupParticipant } from '../developmentCleanup';
import type { NativeExecutionJobLease } from '../unitOfWork';

export interface RuntimeOriginalJobs {
  run<T>(context: ProjectDeletionContext, taskId: TaskId, callback: (identity: NativeExecutionJobLease, heartbeat: () => Promise<boolean>) => Promise<T>): Promise<{ claimed: false } | { claimed: true; value: T }>;
}
/** Root composition supplies original digital owners and independent container evidence. */
export interface RuntimeOriginalStopSources {
  development(context: ProjectDeletionContext): DevelopmentCleanupParticipant;
  digital(context: ProjectDeletionContext, environment: TaskEnvironment): Promise<{ kind: 'ready' } | { kind: 'waiting'; reason: string }>;
  stopped(context: ProjectDeletionContext, environment: TaskEnvironment): Promise<{ digest: string } | undefined>;
}
