import type { BusinessStorageFinalization, ObjectStorageBlocker, WorkloadStopBarrier, TaskVolumeDeletionPermit, TaskVolumeReclaimProof } from '@crewstation/contracts';
import type { Actor, ArchivePlanDto, ArchiveReceiptDto, FinalizationArchive, OperatorArchivePlan, ProjectId, ServiceId, TaskId } from '@crewstation/contracts';
import type { ArchiveLossAssessment, ArchiveLossPageQuery, ConfirmFinalizationLoss } from '@crewstation/contracts';
import type { ArchiveRevisionPreview, ArchiveRevisionPreviewRequest } from '@crewstation/contracts';
import type { ArchiveArtifactDeletion, DeleteArchiveArtifacts } from '@crewstation/contracts';

/** Internal ports; implementations derive identity from the accepted operation, never browser input. */
export interface FinalizationPreparation {
  operatorArchive?: {
    deleteArtifacts?(actor: Actor, scope: { projectId: ProjectId; serviceId: ServiceId; taskId: TaskId }, id: string, input: DeleteArchiveArtifacts): Promise<ArchiveArtifactDeletion>;
    assessRevision?(actor: Actor, scope: { projectId: ProjectId; serviceId: ServiceId; taskId: TaskId }, id: string, input: ArchiveRevisionPreviewRequest): Promise<ArchiveRevisionPreview>;
    assessLoss?(actor: Actor, scope: { projectId: ProjectId; serviceId: ServiceId; taskId: TaskId }, id: string, revision: number, page: ArchiveLossPageQuery): Promise<ArchiveLossAssessment>;
    confirmLoss?(actor: Actor, scope: { projectId: ProjectId; serviceId: ServiceId; taskId: TaskId }, id: string, input: ConfirmFinalizationLoss, dataDigest: string | null): Promise<ArchiveReceiptDto>;
    preflight(actor: Actor, scope: { projectId: ProjectId; serviceId: ServiceId; taskId: TaskId }, archive: FinalizationArchive): Promise<{ spaceId: string }>;
    createPlan(actor: Actor, scope: { projectId: ProjectId; serviceId: ServiceId; taskId: TaskId }, input: OperatorArchivePlan): Promise<ArchivePlanDto>;
  };
  preflight?(caller: { identity: string; token?: string }, taskId: TaskId, archive: FinalizationArchive): Promise<{ spaceId: string }>;
  archive: {
    lossReceipt?(id: string, revision: number): Promise<ArchiveReceiptDto | null>;
    revise?(id: string): Promise<{ applied: boolean; binding: { revision: number; receipt: ArchiveReceiptDto | null } }>;
    permitDeletion?(id: string, revision: number, permitId: string): Promise<void>;
    reclaimed?(id: string, permitId: string, proofId: string): Promise<void>;
    commitArchive(id: string, revision: number, evidence: { stopProofDigest: string; completionProofDigest: string | null }): Promise<{ receipt: ArchiveReceiptDto | null }>;
    bind(id: string): Promise<{ id: string; revision: number; taskId: string; taskGeneration: number; volumeUid: string | null }>;
    observe(id: string, revision: number, sequence: number, observation: ObjectStorageBlocker | null): Promise<boolean>;
  };
  runtime: {
    storageCleanup?: {
      prepare(input: BusinessStorageFinalization): Promise<WorkloadStopBarrier>;
      release(input: BusinessStorageFinalization, permit: TaskVolumeDeletionPermit): Promise<void>;
      proof(input: BusinessStorageFinalization): Promise<TaskVolumeReclaimProof | null>;
      complete(input: BusinessStorageFinalization, proofId: string): Promise<void>;
    };
    archiveExecution?: { ensure(input: BusinessStorageFinalization): Promise<unknown>; stop?(input: BusinessStorageFinalization): Promise<boolean> };
    freezeBusinessStorage(input: BusinessStorageFinalization): Promise<void>;
    resolveBusinessStorage?(input: BusinessStorageFinalization): Promise<string | null>;
    stopBusinessStorage(input: BusinessStorageFinalization): Promise<WorkloadStopBarrier>;
  };
}
