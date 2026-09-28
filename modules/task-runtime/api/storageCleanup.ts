import type { BusinessStorageFinalization, TaskVolumeDeletionPermit, TaskVolumeReclaimProof, WorkloadStopBarrier } from '@crewstation/contracts';

export interface StorageCleanupApi {
  prepare(input: BusinessStorageFinalization): Promise<WorkloadStopBarrier>;
  release(input: BusinessStorageFinalization, permit: TaskVolumeDeletionPermit): Promise<void>;
  proof(input: BusinessStorageFinalization): Promise<TaskVolumeReclaimProof | null>;
  complete(input: BusinessStorageFinalization, proofId: string): Promise<void>;
}
