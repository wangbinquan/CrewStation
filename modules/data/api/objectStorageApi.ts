import type { Actor, AuthorizeObjectStoragePlans, ObjectBackendDto, ObjectPageQuery, ObjectSpaceDto, ObjectStorageObservation, ObjectStoragePlanDto, ObjectStoragePlanInput, ProjectId, RegisterObjectBackend, StorageWindow, StoredObjectDto, StoredObjectPage, UpdateObjectBackend } from '@crewstation/contracts';
import type { ObjectServiceApi } from './objectServiceApi';
import type { ResourceTarget, ResourceValues } from '@crewstation/contracts';
import type { ObjectStorageBlockerPage } from '@crewstation/contracts';
import type { ArchiveReceiptPage, ArchiveReceiptPageQuery, ObjectArchiveHistoryPage } from '@crewstation/contracts';
import type { RotateObjectBackendCredential } from '@crewstation/contracts';

export interface ObjectStorageAdminApi {
  applyResourceChange(actor: Actor, projectId: ProjectId, command: { operationId: string; target: ResourceTarget; expectedRevision: string; values: ResourceValues }): Promise<{ revision: string; effect: string; applied: boolean }>;
  resourceChangeReceipt(projectId: ProjectId, operationId: string): Promise<{ revision: string; effect: string; applied: boolean } | undefined>;
  rotateCredential(actor: Actor, id: string, input: RotateObjectBackendCredential): Promise<ObjectBackendDto>;
  archiveHistory(actor: Actor, target: { backendId: string } | { spaceId: string }, query: ObjectPageQuery): Promise<ObjectArchiveHistoryPage>;
  receiptItems(actor: Actor, id: string, query: ArchiveReceiptPageQuery): Promise<ArchiveReceiptPage>;
  backends(actor: Actor): Promise<ObjectBackendDto[]>;
  registerBackend(actor: Actor, input: RegisterObjectBackend): Promise<ObjectBackendDto>;
  updateBackend(actor: Actor, id: string, input: UpdateObjectBackend): Promise<ObjectBackendDto>;
  plans(actor: Actor, projectId?: ProjectId): Promise<ObjectStoragePlanDto[]>;
  projectPolicy(actor: Actor, projectId: ProjectId): Promise<{ projectId: ProjectId; revision: number; planIds: readonly string[] }>;
  savePlan(actor: Actor, id: string | undefined, input: ObjectStoragePlanInput, expectedRevision?: number): Promise<ObjectStoragePlanDto>;
  authorizePlans(actor: Actor, input: AuthorizeObjectStoragePlans): Promise<{ projectId: ProjectId; revision: number; planIds: readonly string[] }>;
  spaces(actor: Actor, projectId?: ProjectId): Promise<ObjectSpaceDto[]>;
  objects(actor: Actor, spaceId: string, query: ObjectPageQuery): Promise<StoredObjectPage>;
  object(actor: Actor, id: string): Promise<StoredObjectDto>;
  download(actor: Actor, id: string, input: { signal: AbortSignal; range?: string }): ReturnType<ObjectServiceApi['download']>;
  blockers(actor: Actor, target: { backendId: string } | { spaceId: string }, query: ObjectPageQuery): Promise<ObjectStorageBlockerPage>;
  observation(actor: Actor, target: { backendId: string } | { spaceId: string }, window: StorageWindow): Promise<ObjectStorageObservation>;
}
