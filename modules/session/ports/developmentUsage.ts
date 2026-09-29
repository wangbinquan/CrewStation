import type { DevelopmentUsageDrainReason, DevelopmentUsageKey, DevelopmentUsageLoss, DevelopmentUsagePage, DevelopmentUsageReceipt, DevelopmentUsageRegistration, RunnerUsageMeasurement, StoredDevelopmentUsage, TaskId } from '@crewstation/contracts';

export interface DevelopmentUsageStore {
  register(registration: DevelopmentUsageRegistration): Promise<StoredDevelopmentUsage>;
  get(taskId: TaskId, key: DevelopmentUsageKey): Promise<StoredDevelopmentUsage | undefined>;
  ingest(taskId: TaskId, receipt: DevelopmentUsageReceipt, page?: DevelopmentUsagePage): Promise<StoredDevelopmentUsage>;
  acknowledgeRunner(taskId: TaskId, key: DevelopmentUsageKey, through: number): Promise<void>;
  requestDrain(taskId: TaskId, key: DevelopmentUsageKey, reason: DevelopmentUsageDrainReason): Promise<StoredDevelopmentUsage>;
  unavailable(taskId: TaskId, loss: DevelopmentUsageLoss): Promise<StoredDevelopmentUsage>;
  pending(taskIds: TaskId[], limit: number): Promise<StoredDevelopmentUsage[]>;
}
export interface DevelopmentUsageSourceStore {
  next(): Promise<DevelopmentUsagePage | undefined>;
  measurement(key: DevelopmentUsageKey, recordId: string, revision: number): Promise<RunnerUsageMeasurement | undefined>;
  acknowledge(key: DevelopmentUsageKey, through: number): Promise<void>;
}
