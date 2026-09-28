import type { FinalizeBusinessTask, FinalizationPhase, ReviseBusinessArchive, TaskId, UserId } from '@crewstation/contracts';
import type { ExecutionAuthorization } from '../../domain/executionControl';
import type { FinalizationLease, FinalizationOperation, FinalizationProgress } from '../../domain/finalization/operation';
import type { FinalizationRevision } from '../../domain/finalization/revision';

export interface FinalizationAdmission {
  readonly spaceId: string; readonly volumeUid: string | null;
  readonly authorization: ExecutionAuthorization | { readonly administrative: { readonly userId: UserId; readonly reason: string } };
}
export interface FinalizationOperations {
  accept(serviceId: string, taskId: TaskId, input: FinalizeBusinessTask, admission: FinalizationAdmission): Promise<FinalizationOperation>;
  forTask(serviceId: string, taskId: TaskId): Promise<FinalizationOperation | undefined>;
  get(id: string): Promise<FinalizationOperation | undefined>;
  revise(serviceId: string, taskId: TaskId, input: ReviseBusinessArchive, authorization: FinalizationAdmission['authorization']): Promise<FinalizationRevision>;
  revision(id: string): Promise<FinalizationRevision | undefined>;
  settleRevision(lease: FinalizationLease, applied: boolean, errorCode?: string): Promise<boolean>;
  claim(input: { owner: string; leaseSeconds: number; id?: string; phases?: readonly FinalizationPhase[]; revising?: boolean }): Promise<FinalizationOperation | undefined>;
  progress(lease: FinalizationLease, input: FinalizationProgress): Promise<boolean>;
  bindVolume(lease: FinalizationLease, volumeUid: string | null): Promise<FinalizationOperation | undefined>;
}
