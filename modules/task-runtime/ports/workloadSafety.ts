import type { WorkloadAdmissionIdentity, WorkloadConsumer, WorkloadStartPermit, WorkloadStopProof, WorkloadFinalizationFence, WorkloadStopBarrier, TaskVolumeSafetyState, TaskVolumeDeletionPermit, DevelopmentAdmissionState } from '@crewstation/contracts';

/** Supplied by resources; the runtime cannot fabricate node or container stop evidence. */
export interface WorkloadSafetyPort {
  register?(consumer: WorkloadConsumer): Promise<{ consumer: WorkloadConsumer; admissionClosed: boolean; startPermit: WorkloadStartPermit | null; stopProof: WorkloadStopProof | null; developmentAdmission?: DevelopmentAdmissionState }>;
  closeConsumer?(id: string): Promise<NonNullable<Awaited<ReturnType<WorkloadSafetyPort['get']>>>>;
  grantStart?(id: string, input: Omit<WorkloadStartPermit, 'grantedAt'>): Promise<NonNullable<Awaited<ReturnType<WorkloadSafetyPort['get']>>>>;
  sealConsumers(taskId: string, finalization: WorkloadFinalizationFence): Promise<void>;
  freezeTask(taskId: string, finalization: WorkloadFinalizationFence): Promise<void>;
  scanStopped(taskId: string, finalization: WorkloadFinalizationFence, scope: 'business' | 'all'): Promise<WorkloadStopBarrier>;
  closeAdmission(identity: WorkloadAdmissionIdentity): Promise<void>;
  admissionClosed(id: string): Promise<boolean>;
  get(id: string): Promise<{ consumer: WorkloadConsumer; admissionClosed: boolean; startPermit: WorkloadStartPermit | null; stopProof: WorkloadStopProof | null; developmentAdmission?: DevelopmentAdmissionState } | undefined>;
}
export interface TaskVolumePort {
  forTask(taskId: string): Promise<TaskVolumeSafetyState>;
  permitDeletion(resourceId: string, permit: TaskVolumeDeletionPermit): Promise<void>;
}
