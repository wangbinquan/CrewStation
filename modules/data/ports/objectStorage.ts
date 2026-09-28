import type { BusinessExecutionFence, CreateObjectUpload, DataEnv, ObjectStorageBlocker, ObjectStoragePlanInput, ObjectStorageQueue, ObjectStorageSample, ProjectId, RegisterObjectBackend, ServiceId, StorageWindow, UpdateObjectBackend } from '@crewstation/contracts';
import type { ArchiveReceiptPage, ObjectArchiveHistoryPage } from '@crewstation/contracts';
import type { ArchiveHelperAuthority } from '../domain/archiveHelper';
import type {
  ObjectAttemptRecord, ObjectBackendRecord, ObjectPlanRecord, ObjectSource, ObjectSpaceRecord, ObjectUploadRecord, ObjectWriteControl,
  StoredObjectRecord, StorageFreeze,
} from '../domain/objectStorage';

export interface ObjectBackendObservation {
  readonly backendId: string;
  readonly placementRevision: number;
  readonly credentialRevision: number;
  readonly health: ObjectBackendRecord['health'];
  readonly freeBytes: number | null;
  readonly totalBytes: number | null;
  readonly physicalObservedAt?: string | null;
  readonly message: string | null;
  readonly observedAt: string;
}
export interface ObjectProjectPolicy { readonly projectId: ProjectId; readonly revision: number; readonly planIds: readonly string[] }
export interface ObjectCatalogRepository {
  registerBackend(record: ObjectBackendRecord): Promise<ObjectBackendRecord>;
  backend(id: string): Promise<ObjectBackendRecord | undefined>;
  backends(): Promise<ObjectBackendRecord[]>;
  updateBackend(id: string, input: UpdateObjectBackend): Promise<ObjectBackendRecord>;
  observeBackend(input: ObjectBackendObservation): Promise<boolean>;
  savePlan(id: string, input: ObjectStoragePlanInput, expectedRevision?: number): Promise<ObjectPlanRecord>;
  plans(): Promise<ObjectPlanRecord[]>;
  policy(projectId: ProjectId): Promise<ObjectProjectPolicy>;
  authorizePlans(projectId: ProjectId, expectedRevision: number, planIds: readonly string[]): Promise<ObjectProjectPolicy>;
  ensureSpace(input: ObjectSource & { id: string; planId: string; deploymentMode: 'local' | 'production' }): Promise<ObjectSpaceRecord>;
  space(id: string): Promise<ObjectSpaceRecord | undefined>;
  serviceSpace(serviceId: ServiceId, env: DataEnv): Promise<ObjectSpaceRecord | undefined>;
  spaces(projectId?: ProjectId): Promise<ObjectSpaceRecord[]>;
  applyWriteControl(control: ObjectWriteControl): Promise<boolean>;
  freeze(input: StorageFreeze): Promise<boolean>;
  freezeStatus(id: string): Promise<{ phase: 'draining' | 'frozen' | 'released'; epoch: number; blockers: Array<{ kind: 'writer' | 'verification' | 'object-deletion' | 'volume-deletion'; count: number }> }>;
}

export interface UploadAuthority { readonly source: ObjectSource; readonly fence?: BusinessExecutionFence; readonly archive?: ArchiveHelperAuthority }
export interface ObjectTransferClaim { readonly upload: ObjectUploadRecord; readonly attempt: ObjectAttemptRecord; readonly backend: ObjectBackendRecord }
export interface ObjectUploadRepository {
  reserve(spaceId: string, id: string, input: CreateObjectUpload, authority: UploadAuthority): Promise<ObjectUploadRecord>;
  get(id: string): Promise<ObjectUploadRecord | undefined>;
  begin(id: string, attemptId: string, owner: string, authority: UploadAuthority): Promise<ObjectTransferClaim>;
  heartbeat(attempt: ObjectAttemptRecord, receivedBytes: number): Promise<boolean>;
  finish(attempt: ObjectAttemptRecord, result: { receivedBytes: number; sha256: string } | { errorCode: string; uncertain: boolean }): Promise<boolean>;
  requestCommit(id: string, authority: UploadAuthority): Promise<ObjectUploadRecord>;
  claimVerification(owner: string): Promise<ObjectTransferClaim | undefined>;
  verified(attempt: ObjectAttemptRecord, result: { size: number; sha256: string }): Promise<StoredObjectRecord | undefined>;
  verificationFailed(attempt: ObjectAttemptRecord, errorCode: string, retryable: boolean): Promise<boolean>;
  recoverExpired(): Promise<number>;
}

/** Physical operations receive immutable locations; this port does not grant business authority. */
export interface ObjectByteLocation { readonly backendId: string; readonly placementRevision: number; readonly key: string }
export interface ObjectBytes {
  inspectWrite?(location: ObjectByteLocation, signal: AbortSignal): Promise<'committed' | 'unknown'>;
  put(location: ObjectByteLocation, input: { body: ReadableStream<Uint8Array>; size: number; sha256: string; signal: AbortSignal; onBytes?: (bytes: number) => void }): Promise<{ size: number; sha256: string }>;
  get(location: ObjectByteLocation, input: { signal: AbortSignal; range?: string; expected?: { size: number; sha256: string } }): Promise<{ body: ReadableStream<Uint8Array>; size: number; contentRange?: string; completed: Promise<{ size: number; sha256: string }> }>;
  verify(location: ObjectByteLocation, signal: AbortSignal, expected?: { size: number; sha256: string }): Promise<{ size: number; sha256: string }>;
  remove(location: ObjectByteLocation, signal: AbortSignal): Promise<void>;
}

export interface ObjectBackendPlane extends ObjectBytes {
  prepareRotation?(input: { backendId: string; placementRevision: number; credentialRevision: number; accessKeyId: string; secretAccessKey: string; monitoringToken?: string }, signal: AbortSignal): Promise<{ commit(transaction: object): Promise<void> }>;
  configure(backendId: string, placementRevision: number, credentialRevision: number, config: Pick<RegisterObjectBackend, 'endpoint' | 'region' | 'bucket' | 'accessKeyId' | 'secretAccessKey' | 'monitoring'>): Promise<void>;
  probe(backendId: string, placementRevision: number, signal: AbortSignal): Promise<Omit<ObjectBackendObservation, 'freeBytes' | 'totalBytes'> & { freeBytes?: number | null; totalBytes?: number | null }>;
  metrics(): string;
}
export interface ObjectStorageHistory {
  read(input: { backendId: string; spaceId?: string; window: StorageWindow }): Promise<{ samples: ObjectStorageSample[]; observedAt: string | null; stale: boolean; unavailableReason: string | null }>;
}
export interface ObjectReadRepository {
  archiveHistory(spaceIds: readonly string[], limit: number, cursor?: string): Promise<ObjectArchiveHistoryPage>;
  objects(ids: readonly string[]): Promise<StoredObjectRecord[]>;
  receiptPage(id: string, offset: number, limit: number): Promise<({ spaceId: string } & ArchiveReceiptPage) | undefined>;
  page(spaceId: string, cursor: string | undefined, limit: number): Promise<{ items: StoredObjectRecord[]; nextCursor: string | null }>;
  object(id: string): Promise<StoredObjectRecord | undefined>;
  queue(spaceIds: readonly string[]): Promise<ObjectStorageQueue>;
  blockers(spaceIds: readonly string[], limit: number, cursor?: string): Promise<{ items: ObjectStorageBlocker[]; nextCursor: string | null }>;
}
