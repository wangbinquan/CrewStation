import type { RunnerUsageSourcePage, RunnerUsageSourceIdentity, RunnerUsageMeasurement, TaskId } from '@crewstation/contracts';

export interface BusinessUsageSourceStore {
  /** Fair bounded polling; an unacknowledged page remains replayable after restart. */
  next(): Promise<RunnerUsageSourcePage | undefined>;
  /** Private cleanup selects this original execution, rather than the ordinary global queue. */
  offer?(taskId: TaskId, executionId: string): Promise<RunnerUsageSourcePage | undefined>;
  measurement(source: RunnerUsageSourceIdentity, recordId: string, revision: number): Promise<RunnerUsageMeasurement | undefined>;
  acknowledge(taskId: TaskId, executionId: string, through: number): Promise<void>;
}
