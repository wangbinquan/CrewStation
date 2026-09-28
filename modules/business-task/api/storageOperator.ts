import type { Actor, AdministrativeArchiveRevision, AdministrativeFinalization, ArchivePlanDto, BusinessFinalizationDto, BusinessStoragePreview, OperatorArchivePlan, TaskId } from '@crewstation/contracts';
import type { ArchiveLossPageQuery, ArchiveReceiptDto, BusinessStorageLossAssessment, ConfirmFinalizationLoss } from '@crewstation/contracts';
import type { ArchiveRevisionPreview, ArchiveRevisionPreviewRequest } from '@crewstation/contracts';
import type { ArchiveArtifactDeletion, DeleteArchiveArtifacts } from '@crewstation/contracts';

export interface BusinessStorageOperatorApi {
  deleteStorageArtifacts(actor: Actor, taskId: TaskId, input: DeleteArchiveArtifacts): Promise<ArchiveArtifactDeletion>;
  previewStorageArchiveRevision(actor: Actor, taskId: TaskId, input: ArchiveRevisionPreviewRequest): Promise<ArchiveRevisionPreview>;
  assessStorageLoss(actor: Actor, taskId: TaskId, page: ArchiveLossPageQuery): Promise<BusinessStorageLossAssessment>;
  confirmStorageLoss(actor: Actor, taskId: TaskId, input: ConfirmFinalizationLoss): Promise<ArchiveReceiptDto>;
  previewStorageFinalization(actor: Actor, taskId: TaskId): Promise<BusinessStoragePreview>;
  prepareStorageArchive(actor: Actor, taskId: TaskId, input: OperatorArchivePlan): Promise<ArchivePlanDto>;
  finalizeStorageAsOperator(actor: Actor, taskId: TaskId, input: AdministrativeFinalization): Promise<BusinessFinalizationDto>;
  reviseStorageAsOperator(actor: Actor, taskId: TaskId, input: AdministrativeArchiveRevision): Promise<BusinessFinalizationDto>;
}
