import type { ProjectId, RuntimeImageExecutionSnapshot, ServiceId, TaskId, TraceId } from '@crewstation/contracts';

export interface BusinessRecoveryScope { projectId: ProjectId; serviceId: ServiceId; taskId: TaskId }
export interface RebuildBusinessWorkspaceInput extends BusinessRecoveryScope { operationId: string; generation: number; volumeUid: string }
export interface RestartBusinessWorkspaceInput extends BusinessRecoveryScope { newTaskId: TaskId; fingerprint: string; traceId: TraceId }
/** Positive, read-only observations. Missing or failed inspection must never count as stopped. */
export interface BusinessWorkspaceProof {
  state: string; persistent: boolean; stopped: boolean; activeChildren: boolean;
  volumeUid: string | null; volumeVerified: boolean;
  image?: string; runtimeImage?: RuntimeImageExecutionSnapshot;
}
