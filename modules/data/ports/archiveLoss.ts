import type { ArchiveLossAssessment, ArchiveLossPageQuery, ArchiveReceiptDto, ConfirmFinalizationLoss, UserId } from '@crewstation/contracts';
export interface ArchiveLossRepository {
  assess(id: string, revision: number, page: ArchiveLossPageQuery): Promise<ArchiveLossAssessment & { spaceId: string; taskId: string }>;
  confirm(id: string, actorId: UserId, input: ConfirmFinalizationLoss, dataDigest: string | null): Promise<ArchiveReceiptDto>;
}
