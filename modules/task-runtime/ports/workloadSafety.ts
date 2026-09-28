import type { WorkloadAdmissionIdentity, WorkloadConsumer, WorkloadStartPermit, WorkloadStopProof, WorkloadFinalizationFence, WorkloadStopBarrier, TaskVolumeSafetyState, TaskVolumeDeletionPermit } from '@crewstation/contracts';

/** Supplied by resources; the runtime cannot fabricate node or container stop evidence. */
export interface WorkloadSafetyPort {
  sealConsumers(taskId: string, finalization: WorkloadFinalizationFence): Promise<void>;
  freezeTask(taskId: string, finalization: WorkloadFinalizationFence): Promise<void>;
  scanStopped(taskId: string, finalization: WorkloadFinalizationFence, scope: 'business' | 'all'): Promise<WorkloadStopBarrier>;
  closeAdmission(identity: WorkloadAdmissionIdentity): Promise<void>;
  admissionClosed(id: string): Promise<boolean>;
  get(id: string): Promise<{ consumer: WorkloadConsumer; admissionClosed: boolean; startPermit: WorkloadStartPermit | null; stopProof: WorkloadStopProof | null } | undefined>;
}
export interface TaskVolumePort {
  forTask(taskId: string): Promise<TaskVolumeSafetyState>;
  permitDeletion(resourceId: string, permit: TaskVolumeDeletionPermit): Promise<void>;
}
