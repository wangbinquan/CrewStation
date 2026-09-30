import type {
  ArchivePlanDto, ArchivePlanEntry, ArchiveReceiptDto, ArchiveReceiptItem, BusinessExecutionFence, DataEnv, ObjectBackendDto,
  ObjectSpaceDto, ObjectStorageBlocker, ObjectStoragePlanDto, ObjectUploadDto, ProjectId, ServiceId, StoredObjectDto,
} from '@crewstation/contracts';
import { OBJECT_STORAGE_LIMITS } from '@crewstation/contracts';
import { conflict, precondition, quotaExceeded, validation } from '@crewstation/kernel';
import type { ArchiveUploadIdentity } from './archiveHelper';
import type { ArchiveArtifactDeletion } from '@crewstation/contracts';

export interface ObjectBackendRecord extends ObjectBackendDto {
  readonly requestKey: string;
  readonly requestDigest: string;
  readonly activeTransfers: number;
}
export interface ObjectPlanRecord extends ObjectStoragePlanDto { readonly createdAt: string }
export interface ObjectSpaceRecord extends ObjectSpaceDto {
  readonly quotaOverrides?: { quotaBytes: number; maxObjectBytes: number; maxConcurrentTransfers: number };
  readonly maxObjectBytes: number;
  readonly maxConcurrentTransfers: number;
  readonly activeTransfers: number;
  readonly enabled: boolean;
}
export interface ObjectUploadRecord extends ObjectUploadDto {
  readonly reservationReleasedAt?: string;
  readonly archive?: ArchiveUploadIdentity;
  readonly requestKey: string;
  readonly requestDigest: string;
  readonly name: string;
  readonly mediaType: string;
  readonly sha256: string;
  readonly fence: BusinessExecutionFence | null;
  readonly sourcePodUid: string | null;
  readonly currentAttemptId: string | null;
  readonly readyAttemptId: string | null;
  readonly commitRequested: boolean;
  readonly updatedAt: string;
}
export interface ObjectAttemptRecord {
  readonly recovery?: { readonly owner: string; readonly sequence: number; readonly leaseUntil: string; readonly nextRetryAt: string | null; readonly errorCode: string | null };
  readonly id: string;
  readonly uploadId: string;
  readonly spaceId: string;
  readonly backendId: string;
  readonly placementRevision: number;
  readonly key: string;
  readonly owner: string;
  readonly state: 'streaming' | 'uploaded' | 'verifying' | 'verified' | 'unknown' | 'deleting' | 'deleted';
  readonly size: number;
  readonly receivedBytes: number;
  readonly sha256: string;
  readonly leaseUntil: string;
  readonly revision: number;
  readonly errorCode: string | null;
  readonly writerEndedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export interface StoredObjectRecord extends StoredObjectDto {
  readonly archive?: { readonly bindingId: string; readonly revision: number; readonly path: string };
  readonly backendId: string;
  readonly placementRevision: number;
  readonly key: string;
  readonly uploadId: string;
  readonly attemptId: string;
  readonly deletion?: { readonly requestedAt: string; readonly owner: string | null; readonly leaseUntil: string | null; readonly sequence: number; readonly nextRetryAt: string | null; readonly errorCode: string | null };
}
export type ObjectReferenceOwner = 'application' | 'material-version' | 'task' | 'archive-pending' | 'archive-receipt' | 'finalization-guard';
export interface ObjectReferenceRecord {
  readonly objectId: string;
  readonly ownerType: ObjectReferenceOwner;
  readonly ownerId: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly state: 'active' | 'released';
}
export interface ObjectReadTransfer { readonly id: string; readonly objectId: string; readonly spaceId: string; readonly backendId: string; readonly owner: string; readonly expiresAt: string; readonly endedAt: string | null }
export interface ObjectMutation { readonly spaceId: string; readonly requestKey: string; readonly digest: string; readonly objectId: string }
export interface ObjectWriteControl {
  readonly serviceId: ServiceId;
  readonly controlVersion: number;
  readonly epoch: number;
  readonly leaseId: string;
  readonly instanceId: string;
  readonly podUid: string | null;
  readonly leaseUntil: string;
  readonly phase: 'active' | 'frozen';
}
export interface StorageFreeze {
  readonly id: string;
  readonly kind: 'backup' | 'migration';
  readonly backendId: string | null;
  readonly epoch: number;
  readonly active: boolean;
}
export interface ArchivePlanRecord extends ArchivePlanDto {
  readonly operator?: { readonly userId: string; readonly reason: string };
  readonly spaceId: string;
  readonly requestKey: string;
  readonly entries: readonly ArchivePlanEntry[];
  readonly pageDigests: Readonly<Record<number, string>>;
  readonly pageRequests: Readonly<Record<string, string>>;
  readonly pinnedObjectIds: readonly string[];
  readonly sealedByRequestKey: string | null;
}
export interface FinalizationBinding {
  readonly artifactsDeletion?: { readonly requestDigest: string; readonly result: ArchiveArtifactDeletion };
  readonly loss?: { readonly requestKey: string; readonly requestDigest: string; readonly assessmentDigest: string };
  readonly id: string;
  readonly spaceId: string;
  readonly taskId: string;
  readonly taskGeneration: number;
  readonly outcome: 'succeeded' | 'failed' | 'cancelled';
  readonly requestDigest: string;
  readonly volumeUid: string | null;
  readonly revision: number;
  readonly planId: string | null;
  readonly planRevision: number | null;
  readonly manifestDigest: string;
  readonly noArtifactsReason: string | null;
  readonly state: 'prepared' | 'bound' | 'receipted' | 'delete-started' | 'completed' | 'aborted';
  readonly receipt: ArchiveReceiptDto | null;
  readonly stopProofDigest: string | null;
  readonly completionProofDigest: string | null;
  readonly deletePermitId: string | null;
  readonly reclaimProofId: string | null;
  readonly items: readonly ArchiveReceiptItem[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly observation?: ObjectStorageBlocker | null;
  readonly observationSequence?: number;
}
export interface ObjectSource {
  readonly projectId: ProjectId;
  readonly serviceId: ServiceId;
  readonly env: DataEnv;
  readonly fenced: boolean;
  readonly podUid?: string;
  readonly writeAllowed?: boolean;
}

/** Pure checks are repeated while holding the corresponding persistent rows. */
export function assertStorageRevision(actual: number, expected: number): void {
  if (actual !== expected) throw conflict('存储记录已变化，请刷新后重试', { code: 'storage_revision_conflict' });
}
export function assertSameStorageRequest(actual: string, expected: string): void {
  if (actual !== expected) throw conflict('幂等键已用于不同的存储请求', { code: 'storage_request_conflict' });
}
export function assertStorageWrite(control: ObjectWriteControl | undefined, fence: BusinessExecutionFence | undefined, fenced: boolean, now: Date, podUid?: string): void {
  if (!control && !fenced) return;
  if (!control || !fence || !podUid || control.podUid !== podUid || control.phase !== 'active' || control.epoch !== fence.epoch || control.leaseId !== fence.leaseId || control.instanceId !== fence.instanceId || !(Date.parse(control.leaseUntil) > now.getTime())) {
    throw precondition('当前实例没有对象存储写入权限', { code: 'storage_write_fenced' });
  }
}
export function assertObjectAllocation(space: ObjectSpaceRecord, size: number): void {
  if (!space.enabled) throw precondition('对象空间已停止新写入', { code: 'object_space_read_only' });
  if (space.health !== 'ready') throw precondition('对象空间尚未就绪', { code: 'object_space_unavailable' });
  if (!Number.isSafeInteger(size) || size < 0 || size > Math.min(space.maxObjectBytes, OBJECT_STORAGE_LIMITS.objectBytes)) throw validation('文件超过单对象上限');
  if (size > space.quotaBytes - space.usedBytes - space.reservedBytes - space.deletingBytes) throw quotaExceeded('对象空间容量不足', { code: 'object_quota_exceeded', retryAfterSeconds: 30 });
}
export function assertPhysicalAttempt(backend: ObjectBackendRecord, space: ObjectSpaceRecord, size: number): void {
  if (backend.state === 'offline' || backend.health !== 'ready') throw precondition('对象后端不可用', { code: 'object_backend_unavailable' });
  if (size > backend.budgetBytes - backend.reservedBytes) throw quotaExceeded('对象后端暂存容量不足', { code: 'object_backend_capacity', retryAfterSeconds: 30 });
  if (backend.physicalFreeBytes !== null && size > backend.physicalFreeBytes) throw quotaExceeded('对象后端磁盘空间不足', { code: 'object_backend_disk_full', retryAfterSeconds: 30 });
  if (space.activeTransfers >= space.maxConcurrentTransfers) throw quotaExceeded('对象传输并发已满', { code: 'object_transfer_limit', retryAfterSeconds: 5 });
}
export function assertObjectReadable(object: StoredObjectRecord): void {
  if (object.state !== 'ready') throw precondition('对象内容不可读取', { code: object.state === 'degraded' ? 'object_content_degraded' : 'object_not_ready' });
}
export function assertObjectDeletable(object: StoredObjectRecord, references: number): void {
  if (references > 0) throw conflict('对象仍被任务、材料或归档收据引用', { code: 'object_referenced' });
  if (object.state !== 'ready' && object.state !== 'degraded') throw precondition('对象不能进入删除流程', { code: 'object_not_deletable' });
}
export function assertBindingRevision(binding: FinalizationBinding, expected: number, mutable: boolean): void {
  assertStorageRevision(binding.revision, expected);
  if (mutable && !['prepared', 'bound'].includes(binding.state)) throw conflict('归档收据已提交，不能再修改清单', { code: 'archive_already_receipted' });
}

export function backendDto(record: ObjectBackendRecord): ObjectBackendDto {
  const { requestKey: _requestKey, requestDigest: _requestDigest, activeTransfers: _activeTransfers, ...dto } = record;
  return dto;
}
export function spaceDto(record: ObjectSpaceRecord): ObjectSpaceDto {
  const { quotaOverrides: _quotaOverrides, activeTransfers: _activeTransfers, enabled: _enabled, ...dto } = record;
  return { ...dto, quotaRevision: dto.quotaRevision ?? 0, quotaSource: dto.quotaSource ?? 'plan' };
}
export function storedObjectDto(record: StoredObjectRecord): StoredObjectDto {
  const { backendId: _backendId, placementRevision: _placementRevision, key: _key, uploadId: _uploadId, attemptId: _attemptId, deletion: _deletion, archive: _archive, ...dto } = record;
  return dto;
}
export function uploadDto(record: ObjectUploadRecord): ObjectUploadDto {
  const { reservationReleasedAt: _released, archive: _archive, requestKey: _requestKey, requestDigest: _requestDigest, name: _name, mediaType: _mediaType, sha256: _sha256, fence: _fence, sourcePodUid: _sourcePodUid, currentAttemptId: _currentAttemptId, readyAttemptId: _readyAttemptId, commitRequested: _commitRequested, updatedAt: _updatedAt, ...dto } = record;
  return dto;
}
