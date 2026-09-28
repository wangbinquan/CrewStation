import type { Actor, ArchivePlanDto, FinalizationArchive, OperatorArchivePlan, ProjectId, ServiceId, TaskId } from '@crewstation/contracts';
import type { ArchiveLossAssessment, ArchiveLossPageQuery, ArchiveReceiptDto, ConfirmFinalizationLoss } from '@crewstation/contracts';
import type { ArchiveRevisionPreview, ArchiveRevisionPreviewRequest } from '@crewstation/contracts';
import type { ArchiveArtifactDeletion, DeleteArchiveArtifacts } from '@crewstation/contracts';

/** Task scope is provided by the owning business module, never accepted directly from HTTP. */
export interface ArchiveOperatorScope { projectId: ProjectId; serviceId: ServiceId; taskId: TaskId }
export interface ArchiveAdministrationApi {
  deleteArtifacts(actor: Actor, scope: ArchiveOperatorScope, id: string, input: DeleteArchiveArtifacts): Promise<ArchiveArtifactDeletion>;
  assessRevision(actor: Actor, scope: ArchiveOperatorScope, id: string, input: ArchiveRevisionPreviewRequest): Promise<ArchiveRevisionPreview>;
  assessLoss(actor: Actor, scope: ArchiveOperatorScope, id: string, revision: number, page: ArchiveLossPageQuery): Promise<ArchiveLossAssessment>;
  confirmLoss(actor: Actor, scope: ArchiveOperatorScope, id: string, input: ConfirmFinalizationLoss, dataDigest: string | null): Promise<ArchiveReceiptDto>;
  preflight(actor: Actor, scope: ArchiveOperatorScope, archive: FinalizationArchive): Promise<{ spaceId: string }>;
  createPlan(actor: Actor, scope: ArchiveOperatorScope, input: OperatorArchivePlan): Promise<ArchivePlanDto>;
}
