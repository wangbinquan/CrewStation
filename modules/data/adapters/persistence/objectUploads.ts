import { assertTransferOwnerActive } from './objects/transferOwnerState';
import { and, eq, inArray, lte } from 'drizzle-orm';
import type { Database, Executor } from '@crewstation/persistence';
import { conflict, isPlatformError, jsonHash, notFound, precondition, quotaExceeded } from '@crewstation/kernel';
import type { ObjectAttemptRecord, ObjectBackendRecord, ObjectSpaceRecord, ObjectUploadRecord } from '../../domain/objectStorage';
import { assertObjectAllocation, assertPhysicalAttempt, assertSameStorageRequest } from '../../domain/objectStorage';
import type { ObjectTransferClaim, ObjectUploadRepository, UploadAuthority } from '../../ports/objectStorage';
import { assertObjectStorageUnfrozen, authorizeObjectWrite, objectStorageTransaction, requireObjectBackend, requireObjectSpace, saveObjectBackend, saveObjectSpace } from './objectCatalog';
import { objectAttempts, objectBackends, objectSpaces, objectUploads, storedObjects } from './objectTables';
import { archiveFileEntry, assertArchiveReservation, authorizeUpload } from './archive/uploadAuthority';
import { archiveReference } from './archive/references';

export const OBJECT_TRANSFER_LEASE_MS = 90_000;
export interface ObjectTransferLimits { readonly global: number; readonly backend: number; readonly project: number }
export const DEFAULT_OBJECT_TRANSFER_LIMITS: ObjectTransferLimits = { global: 64, backend: 16, project: 8 };
export async function requireObjectUpload(db: Executor, id: string): Promise<ObjectUploadRecord> {
  const row = (await db.select().from(objectUploads).where(eq(objectUploads.id, id)))[0];
  if (!row) throw notFound('对象上传', id);
  return row.body;
}
export async function saveObjectUpload(db: Executor, upload: ObjectUploadRecord): Promise<void> {
  await db.update(objectUploads).set({ body: upload, state: upload.state, updatedAt: new Date(upload.updatedAt) }).where(eq(objectUploads.id, upload.id));
}
export async function saveObjectAttempt(db: Executor, attempt: ObjectAttemptRecord): Promise<void> {
  await db.update(objectAttempts).set({ body: attempt, state: attempt.state, leaseUntil: new Date(attempt.leaseUntil) }).where(eq(objectAttempts.id, attempt.id));
}
export async function ownedAttempt(db: Executor, claim: ObjectAttemptRecord): Promise<ObjectAttemptRecord | undefined> {
  const record = (await db.select().from(objectAttempts).where(eq(objectAttempts.id, claim.id)))[0]?.body;
  return record?.owner === claim.owner && record.revision === claim.revision ? record : undefined;
}
export async function assertTransferCapacity(db: Executor, backend: ObjectBackendRecord, space: ObjectSpaceRecord, limits: ObjectTransferLimits): Promise<void> {
  const project = (await db.select().from(objectSpaces).where(eq(objectSpaces.projectId, space.projectId))).reduce((n, r) => n + r.body.activeTransfers, 0);
  const global = (await db.select().from(objectBackends)).reduce((n, r) => n + r.body.activeTransfers, 0);
  if (global >= limits.global || backend.activeTransfers >= limits.backend || project >= limits.project || space.activeTransfers >= space.maxConcurrentTransfers) throw quotaExceeded('对象传输并发已满', { code: 'object_transfer_limit', retryAfterSeconds: 5 });
}
export async function changeTransferCount(db: Executor, backend: ObjectBackendRecord, space: ObjectSpaceRecord, delta: 1 | -1): Promise<void> {
  await saveObjectBackend(db, { ...backend, activeTransfers: backend.activeTransfers + delta });
  await saveObjectSpace(db, { ...space, activeTransfers: space.activeTransfers + delta });
}

export function objectUploadRepository(db: Database, limits = DEFAULT_OBJECT_TRANSFER_LIMITS): ObjectUploadRepository {
  return {
    reserve: (spaceId, id, input, authority) => objectStorageTransaction(db, async (tx, now) => {
      const space = await requireObjectSpace(tx, spaceId);
      await authorizeUpload(tx, space, authority, now);
      const { fence: _fence, ...content } = input;
      const digest = jsonHash(content);
      const old = (await tx.select().from(objectUploads).where(and(eq(objectUploads.spaceId, spaceId), eq(objectUploads.requestKey, input.requestKey))))[0]?.body;
      if (old) { await authorizeUpload(tx, space, authority, now, old); assertSameStorageRequest(old.requestDigest, digest); return old; }
      const backend = await requireObjectBackend(tx, space.backendId);
      if (!['active', 'no-new-spaces'].includes(backend.state)) throw precondition('对象后端停止接收新上传', { code: 'object_backend_read_only' });
      assertObjectAllocation(space, input.size);
      if (authority.archive) await assertArchiveReservation(tx, authority.archive, input);
      const upload: ObjectUploadRecord = {
        id, spaceId, name: input.name, mediaType: input.mediaType, sha256: input.sha256, size: input.size, state: 'waiting',
        receivedBytes: 0, objectId: null, operationId: null, errorCode: null, retryable: true, nextRetryAt: null,
        createdAt: now.toISOString(), updatedAt: now.toISOString(), requestKey: input.requestKey, requestDigest: digest,
        fence: authority.fence ?? null, sourcePodUid: authority.source.podUid ?? null, currentAttemptId: null, readyAttemptId: null, commitRequested: false,
        ...(authority.archive ? { archive: { bindingId: authority.archive.bindingId, revision: authority.archive.revision, path: authority.archive.path } } : {}),
      };
      await tx.insert(objectUploads).values({ id, spaceId, requestKey: input.requestKey, state: upload.state, body: upload, updatedAt: now });
      await saveObjectSpace(tx, { ...space, reservedBytes: space.reservedBytes + input.size });
      return upload;
    }),
    get: async (id) => (await db.select().from(objectUploads).where(eq(objectUploads.id, id)))[0]?.body,
    begin: (id, attemptId, owner, authority) => objectStorageTransaction(db, (tx, now) => beginAttempt(tx, { id, attemptId, owner, authority, limits }, now)),
    heartbeat: (claim, receivedBytes) => objectStorageTransaction(db, async (tx, now) => {
      const attempt = await ownedAttempt(tx, claim);
      if (!attempt || !['streaming', 'verifying'].includes(attempt.state) || Date.parse(attempt.leaseUntil) <= now.getTime()) return false;
      if (!Number.isSafeInteger(receivedBytes) || receivedBytes < attempt.receivedBytes || receivedBytes > attempt.size) return false;
      await saveObjectAttempt(tx, { ...attempt, receivedBytes, leaseUntil: new Date(now.getTime() + OBJECT_TRANSFER_LEASE_MS).toISOString(), updatedAt: now.toISOString() });
      if (attempt.state === 'streaming') { const upload = await requireObjectUpload(tx, attempt.uploadId); if (upload.currentAttemptId === attempt.id) await saveObjectUpload(tx, { ...upload, receivedBytes, updatedAt: now.toISOString() }); }
      return true;
    }),
    finish: (claim, result) => objectStorageTransaction(db, async (tx, now) => {
      const attempt = await ownedAttempt(tx, claim);
      if (!attempt || !['streaming', 'unknown'].includes(attempt.state) || attempt.writerEndedAt) return false;
      const upload = await requireObjectUpload(tx, attempt.uploadId);
      const uncertain = 'errorCode' in result && result.uncertain;
      const errorCode = 'errorCode' in result ? result.errorCode : result.receivedBytes !== attempt.size || result.sha256 !== attempt.sha256 ? 'object_digest_mismatch' : null;
      const current = upload.currentAttemptId === attempt.id && attempt.state === 'streaming' && Date.parse(attempt.leaseUntil) > now.getTime();
      const accepted = current && !errorCode;
      const time = now.toISOString();
      await saveObjectAttempt(tx, { ...attempt, state: accepted ? 'uploaded' : 'unknown', errorCode, writerEndedAt: uncertain ? null : time, updatedAt: time, ...('receivedBytes' in result ? { receivedBytes: result.receivedBytes } : {}) });
      if (!uncertain) await changeTransferCount(tx, await requireObjectBackend(tx, attempt.backendId), await requireObjectSpace(tx, attempt.spaceId), -1);
      if (upload.currentAttemptId === attempt.id) await saveObjectUpload(tx, { ...upload, state: accepted ? 'verifying' : 'failed', receivedBytes: 'receivedBytes' in result ? result.receivedBytes : attempt.receivedBytes, errorCode: accepted ? null : errorCode ?? 'object_attempt_expired', retryable: errorCode !== 'object_digest_mismatch', updatedAt: time });
      return accepted;
    }),
    requestCommit: (id, authority) => objectStorageTransaction(db, async (tx, now) => {
      const upload = await requireObjectUpload(tx, id), space = await requireObjectSpace(tx, upload.spaceId);
      await authorizeUpload(tx, space, authority, now, upload);
      if (upload.state === 'aborted') throw precondition('上传已经取消');
      if (upload.state === 'ready') return upload;
      const next = { ...upload, commitRequested: true, operationId: upload.id, fence: authority.fence ?? null, sourcePodUid: authority.source.podUid ?? null, updatedAt: now.toISOString() };
      await saveObjectUpload(tx, next); return next;
    }),
    ...objectVerificationRepository(db, limits),
    recoverExpired: () => objectStorageTransaction(db, async (tx, now) => {
      const rows = await tx.select().from(objectAttempts).where(and(inArray(objectAttempts.state, ['streaming', 'verifying']), lte(objectAttempts.leaseUntil, now))).limit(100);
      for (const { body } of rows) {
        // Lease expiry never proves a remote PUT ended. Keep its concurrency and physical reservation.
        if (body.state === 'verifying') await changeTransferCount(tx, await requireObjectBackend(tx, body.backendId), await requireObjectSpace(tx, body.spaceId), -1);
        await saveObjectAttempt(tx, { ...body, state: body.state === 'streaming' ? 'unknown' : 'uploaded', errorCode: 'object_attempt_expired', updatedAt: now.toISOString() });
        const upload = await requireObjectUpload(tx, body.uploadId);
        if (upload.currentAttemptId === body.id) await saveObjectUpload(tx, { ...upload, state: body.state === 'streaming' ? 'failed' : 'verifying', retryable: true, errorCode: 'object_attempt_expired', updatedAt: now.toISOString() });
      }
      return rows.length;
    }),
  };
}

async function beginAttempt(db: Executor, input: { id: string; attemptId: string; owner: string; authority: UploadAuthority; limits: ObjectTransferLimits }, now: Date): Promise<ObjectTransferClaim> {
  await assertTransferOwnerActive(db, input.owner);
  const upload = await requireObjectUpload(db, input.id), space = await requireObjectSpace(db, upload.spaceId), backend = await requireObjectBackend(db, space.backendId);
  await authorizeUpload(db, space, input.authority, now, upload);
  if (!space.enabled || !['active', 'no-new-spaces'].includes(backend.state)) throw precondition('对象空间停止新传输');
  if (['ready', 'aborted'].includes(upload.state) || !upload.retryable) throw precondition('此上传不能再次写入');
  if (upload.currentAttemptId) {
    const old = (await db.select().from(objectAttempts).where(eq(objectAttempts.id, upload.currentAttemptId)))[0]?.body;
    if (old && ['streaming', 'uploaded', 'verifying', 'verified'].includes(old.state)) throw conflict('上传或验证仍在进行，请查询原操作', { code: 'object_upload_in_progress' });
  }
  assertPhysicalAttempt(backend, space, upload.size);
  await assertTransferCapacity(db, backend, space, input.limits);
  const time = now.toISOString();
  const attempt: ObjectAttemptRecord = {
    id: input.attemptId, uploadId: upload.id, spaceId: space.id, backendId: backend.id, placementRevision: backend.placementRevision,
    key: `spaces/${space.id}/attempts/${input.attemptId}`, owner: input.owner, state: 'streaming', size: upload.size, receivedBytes: 0,
    sha256: upload.sha256, leaseUntil: new Date(now.getTime() + OBJECT_TRANSFER_LEASE_MS).toISOString(), revision: 1,
    errorCode: null, writerEndedAt: null, createdAt: time, updatedAt: time,
  };
  await db.insert(objectAttempts).values({ id: attempt.id, uploadId: upload.id, spaceId: space.id, backendId: backend.id, state: attempt.state, leaseUntil: new Date(attempt.leaseUntil), body: attempt });
  await changeTransferCount(db, { ...backend, reservedBytes: backend.reservedBytes + upload.size }, space, 1);
  const next = { ...upload, currentAttemptId: attempt.id, state: 'uploading' as const, errorCode: null, receivedBytes: 0, fence: input.authority.fence ?? null, sourcePodUid: input.authority.source.podUid ?? null, updatedAt: time };
  await saveObjectUpload(db, next);
  return { upload: next, attempt, backend };
}

function objectVerificationRepository(db: Database, limits: ObjectTransferLimits): Pick<ObjectUploadRepository, 'claimVerification' | 'verified' | 'verificationFailed'> {
  return {
    claimVerification: (owner) => objectStorageTransaction(db, async (tx, now) => {
      const pending = await tx.select().from(objectAttempts).where(eq(objectAttempts.state, 'uploaded')).orderBy(objectAttempts.id).limit(100);
      for (const { body: attempt } of pending) {
        const upload = await requireObjectUpload(tx, attempt.uploadId);
        if (!upload.commitRequested || upload.state !== 'verifying' || upload.currentAttemptId !== attempt.id || (upload.nextRetryAt && Date.parse(upload.nextRetryAt) > now.getTime())) continue;
        const backend = await requireObjectBackend(tx, attempt.backendId), space = await requireObjectSpace(tx, attempt.spaceId);
        if (backend.state === 'offline' || backend.health !== 'ready') continue;
        try { await assertObjectStorageUnfrozen(tx, backend.id); await assertTransferCapacity(tx, backend, space, limits); }
        catch (error) { if (isPlatformError(error) && ['precondition', 'quota_exceeded'].includes(error.kind)) continue; throw error; }
        const next = { ...attempt, owner, revision: attempt.revision + 1, state: 'verifying' as const, leaseUntil: new Date(now.getTime() + OBJECT_TRANSFER_LEASE_MS).toISOString(), updatedAt: now.toISOString() };
        await saveObjectAttempt(tx, next);
        await changeTransferCount(tx, backend, space, 1);
        return { upload, attempt: next, backend };
      }
      return undefined;
    }),
    verified: (claim, result) => objectStorageTransaction(db, async (tx, now) => {
      const attempt = await ownedAttempt(tx, claim);
      if (!attempt || attempt.state !== 'verifying' || Date.parse(attempt.leaseUntil) <= now.getTime()) return undefined;
      const upload = await requireObjectUpload(tx, attempt.uploadId), space = await requireObjectSpace(tx, attempt.spaceId);
      if (upload.currentAttemptId !== attempt.id || upload.objectId) return undefined;
      if (result.size !== attempt.size || result.sha256 !== attempt.sha256 || !attempt.writerEndedAt) throw precondition('对象读回校验不符', { code: 'object_digest_mismatch' });
      if (upload.archive) await archiveFileEntry(tx, upload.archive, space.id);
      else await authorizeObjectWrite(tx, space, { projectId: space.projectId, serviceId: space.serviceId, env: space.env, fenced: upload.fence !== null, ...(upload.sourcePodUid ? { podUid: upload.sourcePodUid } : {}) }, upload.fence ?? undefined, now);
      const time = now.toISOString();
      const object = {
        id: upload.id, spaceId: space.id, revision: 1, name: upload.name, mediaType: upload.mediaType, size: attempt.size, sha256: attempt.sha256,
        state: 'ready' as const, referenceCount: 0, createdAt: upload.createdAt, verifiedAt: time, message: null,
        backendId: attempt.backendId, placementRevision: attempt.placementRevision, key: attempt.key, uploadId: upload.id, attemptId: attempt.id,
        ...(upload.archive ? { archive: upload.archive } : {}),
      };
      await tx.insert(storedObjects).values({ id: object.id, spaceId: space.id, state: object.state, body: object });
      await saveObjectAttempt(tx, { ...attempt, state: 'verified', updatedAt: time });
      await saveObjectUpload(tx, { ...upload, objectId: object.id, readyAttemptId: attempt.id, state: 'ready', receivedBytes: attempt.size, retryable: false, errorCode: null, nextRetryAt: null, updatedAt: time });
      await changeTransferCount(tx, await requireObjectBackend(tx, attempt.backendId), { ...space, reservedBytes: space.reservedBytes - attempt.size, usedBytes: space.usedBytes + attempt.size, objectCount: space.objectCount + 1 }, -1);
      return upload.archive ? archiveReference(tx, space.id, object.id, { type: 'archive-pending', id: upload.archive.bindingId, revision: upload.archive.revision }, 'active', now) : object;
    }),
    verificationFailed: (claim, errorCode, retryable) => objectStorageTransaction(db, async (tx, now) => {
      const attempt = await ownedAttempt(tx, claim);
      if (!attempt || attempt.state !== 'verifying' || Date.parse(attempt.leaseUntil) <= now.getTime()) return false;
      const upload = await requireObjectUpload(tx, attempt.uploadId);
      const time = now.toISOString(), delay = Math.min(300_000, 5000 * 2 ** Math.min(attempt.revision, 6));
      await saveObjectAttempt(tx, { ...attempt, state: retryable ? 'uploaded' : 'unknown', errorCode, updatedAt: time });
      await changeTransferCount(tx, await requireObjectBackend(tx, attempt.backendId), await requireObjectSpace(tx, attempt.spaceId), -1);
      if (upload.currentAttemptId === attempt.id) await saveObjectUpload(tx, { ...upload, state: retryable ? 'verifying' : 'failed', errorCode, retryable, nextRetryAt: retryable ? new Date(now.getTime() + delay).toISOString() : null, updatedAt: time });
      return true;
    }),
  };
}
