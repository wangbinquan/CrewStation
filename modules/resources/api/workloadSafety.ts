import type { WorkloadAdmissionIdentity, WorkloadConsumer, WorkloadStartPermit, WorkloadStopProof, WorkloadStopBarrier, WorkloadFinalizationFence, DevelopmentAdmissionState, DevelopmentAdmissionReceipt } from '@crewstation/contracts';

export interface WorkloadConsumerState {
  readonly consumer: WorkloadConsumer;
  /** A closed admission with no start permit is a durable no-writer tombstone, not a fabricated Pod proof. */
  readonly admissionClosed: boolean;
  readonly startPermit: WorkloadStartPermit | null;
  readonly stopProof: WorkloadStopProof | null;
  /** Omitted for legacy rows; only the first original registration selects receipt protection. */
  readonly developmentAdmission?: DevelopmentAdmissionState;
}

/** Internal, authenticated owner/observer ports. No public caller can issue start or stop evidence. */
export interface WorkloadSafety {
  sealConsumers(taskId: string, finalization: WorkloadFinalizationFence): Promise<void>;
  scanStopped(taskId: string, finalization: WorkloadFinalizationFence, scope: 'business' | 'all'): Promise<WorkloadStopBarrier>;
  closeAdmission(identity: WorkloadAdmissionIdentity): Promise<void>;
  admissionClosed(consumerId: string): Promise<boolean>;
  register(consumer: WorkloadConsumer): Promise<WorkloadConsumerState>;
  get(consumerId: string): Promise<WorkloadConsumerState | undefined>;
  list(taskId: string, after?: string): Promise<{ items: WorkloadConsumerState[]; next: string | null }>;
  closeConsumer(consumerId: string): Promise<WorkloadConsumerState>;
  freezeTask(taskId: string, finalization: { operationId: string; revision: number }): Promise<void>;
  grantStart(consumerId: string, input: Omit<WorkloadStartPermit, 'grantedAt'>): Promise<WorkloadConsumerState>;
  recordStop(proof: WorkloadStopProof): Promise<WorkloadStopProof>;
  bindDevelopmentAdmission?(receipt: DevelopmentAdmissionReceipt): Promise<WorkloadConsumerState>;
}
