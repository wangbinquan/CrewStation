import type { TaskVolumeClaim, TaskVolumeDeletionPermit, TaskVolumeReclaimProof, TaskVolumeSafetyState, TaskVolumeTarget } from '@crewstation/contracts';

/** Internal ownership and observer handshake. No general release action accepts these proofs. */
export interface TaskVolumes {
  forTask(taskId: string): Promise<TaskVolumeSafetyState>;
  get(resourceId: string): Promise<TaskVolumeSafetyState>;
  beginProvision(resourceId: string): Promise<void>;
  recordClaim(resourceId: string, claim: TaskVolumeClaim): Promise<void>;
  recordTarget(resourceId: string, target: TaskVolumeTarget): Promise<void>;
  permitDeletion(resourceId: string, permit: TaskVolumeDeletionPermit): Promise<void>;
  recordReclaimed(resourceId: string, proof: TaskVolumeReclaimProof): Promise<void>;
}
