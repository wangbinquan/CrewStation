import type { AuthorizeObjectStoragePlans, ObjectBackendDto, ObjectPageQuery, ObjectProjectPolicyDto, ObjectSpaceDto, ObjectStorageObservation, ObjectStoragePlanDto, ObjectStoragePlanInput, RegisterObjectBackend, StorageWindow, StoredObjectDto, StoredObjectPage, UpdateObjectBackend } from '@crewstation/contracts';
import type { Transport } from '../../httpTransport';
import { buildUrl, segment } from '../../requestUrl';
import type { AdministrativeFinalization, ArchivePlanDto, BusinessFinalizationDto, BusinessStoragePreview, OperatorArchivePlan, BusinessTaskStorageDetail, ObjectStorageBlockerPage } from '@crewstation/contracts';
import type { ArchiveReceiptPage, ArchiveReceiptPageQuery, ObjectArchiveHistoryPage } from '@crewstation/contracts';
import type { BusinessExecutionTaskPage, BusinessExecutionTaskQuery } from '@crewstation/contracts';
import type { ArchiveLossPageQuery, ArchiveReceiptDto, BusinessStorageLossAssessment, ConfirmFinalizationLoss } from '@crewstation/contracts';
import type { AdministrativeArchiveRevision, ArchiveRevisionPreview, ArchiveRevisionPreviewRequest } from '@crewstation/contracts';
import type { RotateObjectBackendCredential } from '@crewstation/contracts';
import type { ArchiveArtifactDeletion, DeleteArchiveArtifacts } from '@crewstation/contracts';

export function objectStorageResource(transport: Transport) {
  const base = '/v3/object-storage', admin = '/v3/admin/object-storage';
  return {
    deleteArtifacts: (taskId: string, input: DeleteArchiveArtifacts) => transport.request<ArchiveArtifactDeletion>('POST', `${base}/tasks/${segment(taskId)}/delete-artifacts`, { body: input }),
    rotateCredential: (id: string, input: RotateObjectBackendCredential) => transport.request<ObjectBackendDto>('POST', `${admin}/backends/${segment(id)}/rotate-credential`, { body: input }),
    revisionPreview: (taskId: string, input: ArchiveRevisionPreviewRequest) => transport.request<ArchiveRevisionPreview>('POST', `${base}/tasks/${segment(taskId)}/archive-revision-preview`, { body: input }),
    reviseArchive: (taskId: string, input: AdministrativeArchiveRevision) => transport.request<BusinessFinalizationDto>('POST', `${base}/tasks/${segment(taskId)}/revise-archive`, { body: input }),
    assessLoss: (taskId: string, query: Partial<ArchiveLossPageQuery> = {}) => transport.request<BusinessStorageLossAssessment>('GET', `${base}/tasks/${segment(taskId)}/loss-assessment`, { query }),
    confirmLoss: (taskId: string, input: ConfirmFinalizationLoss) => transport.request<ArchiveReceiptDto>('POST', `${base}/tasks/${segment(taskId)}/confirm-loss`, { body: input }),
    tasks: (projectId: string, query: Omit<BusinessExecutionTaskQuery, 'projectId'> = {}) => transport.request<BusinessExecutionTaskPage>('GET', `/v3/projects/${segment(projectId)}/object-storage/tasks`, { query }),
    finalizationPreview: (taskId: string) => transport.request<BusinessStoragePreview>('GET', `${base}/tasks/${segment(taskId)}/finalization-preview`),
    prepareArchive: (taskId: string, input: OperatorArchivePlan) => transport.request<ArchivePlanDto>('POST', `${base}/tasks/${segment(taskId)}/archive-plans`, { body: input }),
    finalize: (taskId: string, input: AdministrativeFinalization) => transport.request<BusinessFinalizationDto>('POST', `${base}/tasks/${segment(taskId)}/finalize`, { body: input }),
    task: (taskId: string) => transport.request<BusinessTaskStorageDetail>('GET', `${base}/tasks/${segment(taskId)}`),
    archiveHistory: (target: { backendId: string } | { spaceId: string }, query: Partial<ObjectPageQuery> = {}) => transport.request<ObjectArchiveHistoryPage>('GET', 'backendId' in target ? `${admin}/backends/${segment(target.backendId)}/finalizations` : `${base}/spaces/${segment(target.spaceId)}/finalizations`, { query }),
    receiptItems: (id: string, query: Partial<ArchiveReceiptPageQuery> = {}) => transport.request<ArchiveReceiptPage>('GET', `${base}/finalizations/${segment(id)}/receipt-items`, { query }),
    backends: () => transport.request<{ items: ObjectBackendDto[] }>('GET', `${admin}/backends`),
    registerBackend: (input: RegisterObjectBackend) => transport.request<ObjectBackendDto>('POST', `${admin}/backends`, { body: input }),
    updateBackend: (id: string, input: UpdateObjectBackend) => transport.request<ObjectBackendDto>('PUT', `${admin}/backends/${segment(id)}`, { body: input }),
    savePlan: (input: ObjectStoragePlanInput, previous?: { id: string; revision: number }) => previous
      ? transport.request<ObjectStoragePlanDto>('PUT', `${admin}/plans/${segment(previous.id)}`, { body: { expectedRevision: previous.revision, plan: input } })
      : transport.request<ObjectStoragePlanDto>('POST', `${admin}/plans`, { body: input }),
    projectPolicy: (projectId: string) => transport.request<ObjectProjectPolicyDto>('GET', `${admin}/projects/${segment(projectId)}/policy`),
    authorizePlans: (input: AuthorizeObjectStoragePlans) => transport.request<ObjectProjectPolicyDto>('PUT', `${admin}/project-plans`, { body: input }),
    spaces: (projectId?: string) => transport.request<{ items: ObjectSpaceDto[] }>('GET', projectId ? `/v3/projects/${segment(projectId)}/object-storage/spaces` : `${admin}/spaces`),
    plans: (projectId?: string) => transport.request<{ items: ObjectStoragePlanDto[] }>('GET', projectId ? `/v3/projects/${segment(projectId)}/object-storage/plans` : `${admin}/plans`),
    observation: (target: { backendId: string } | { spaceId: string }, window: StorageWindow = '1h') => transport.request<ObjectStorageObservation>('GET', 'backendId' in target ? `${admin}/backends/${segment(target.backendId)}/observation` : `${base}/spaces/${segment(target.spaceId)}/observation`, { query: { window } }),
    objects: (spaceId: string, query: Partial<ObjectPageQuery> = {}) => transport.request<StoredObjectPage>('GET', `${base}/spaces/${segment(spaceId)}/objects`, { query }),
    object: (id: string) => transport.request<StoredObjectDto>('GET', `${base}/objects/${segment(id)}`),
    downloadUrl: (id: string) => buildUrl(transport.baseUrl, `${base}/objects/${segment(id)}/content`),
    blockers: (target: { backendId: string } | { spaceId: string }, query: Partial<ObjectPageQuery> = {}) => transport.request<ObjectStorageBlockerPage>('GET', 'backendId' in target ? `${admin}/backends/${segment(target.backendId)}/blockers` : `${base}/spaces/${segment(target.spaceId)}/blockers`, { query }),
  };
}
export type ObjectStorageResource = ReturnType<typeof objectStorageResource>;
