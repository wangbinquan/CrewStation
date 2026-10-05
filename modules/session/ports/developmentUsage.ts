import type { DevelopmentNativePageEvidence, DevelopmentUsageDrainReason, DevelopmentUsageLookup, DevelopmentUsageKey, DevelopmentUsageLoss, DevelopmentUsagePage, DevelopmentUsageReceipt, DevelopmentUsageRegistration, RunnerUsageMeasurement, StoredDevelopmentUsage, TaskId } from '@crewstation/contracts';

export interface DevelopmentUsageStore {
  lookup(taskId: TaskId): Promise<DevelopmentUsageLookup>;
  register(registration: DevelopmentUsageRegistration): Promise<StoredDevelopmentUsage>;
  get(taskId: TaskId, key: DevelopmentUsageKey): Promise<StoredDevelopmentUsage | undefined>;
  ingest(taskId: TaskId, receipt: DevelopmentUsageReceipt, page?: DevelopmentUsagePage, nativeCopies?: DevelopmentNativePageEvidence[]): Promise<StoredDevelopmentUsage>;
  verifyRunnerCopy(taskId: TaskId, key: DevelopmentUsageKey, through: number): Promise<void>;
  nativePage(key: DevelopmentUsageKey, passId: string, ordinal: string): Promise<DevelopmentNativePageEvidence | undefined>;
  acknowledgeRunner(taskId: TaskId, key: DevelopmentUsageKey, through: number): Promise<void>;
  requestDrain(taskId: TaskId, key: DevelopmentUsageKey, reason: DevelopmentUsageDrainReason): Promise<StoredDevelopmentUsage>;
  unavailable(taskId: TaskId, loss: DevelopmentUsageLoss): Promise<StoredDevelopmentUsage>;
  pending(taskIds: TaskId[], limit: number): Promise<StoredDevelopmentUsage[]>;
}
export interface DevelopmentUsageSourceStore {
  next(): Promise<DevelopmentUsagePage | undefined>;
  /** Private cleanup selects the exact registered original journal. */
  offer?(key: DevelopmentUsageKey): Promise<DevelopmentUsagePage | undefined>;
  nativePage?(key: DevelopmentUsageKey, passId: string, ordinal: string): Promise<DevelopmentNativePageEvidence | undefined>;
  measurement(key: DevelopmentUsageKey, recordId: string, revision: number): Promise<RunnerUsageMeasurement | undefined>;
  acknowledge(key: DevelopmentUsageKey, through: number): Promise<void>;
}
