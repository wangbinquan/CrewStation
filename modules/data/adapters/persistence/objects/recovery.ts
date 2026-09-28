import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import { isPlatformError } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import type { ObjectAttemptRecord, ObjectUploadRecord } from '../../../domain/objectStorage';
import type { ObjectRecoveryRepository } from '../../../ports/objectRecovery';
import { assertObjectStorageUnfrozen, objectStorageTransaction, requireObjectBackend, requireObjectSpace, saveObjectBackend, saveObjectSpace } from '../objectCatalog';
import { objectAttempts, objectUploads } from '../objectTables';
import { changeTransferCount, requireObjectUpload, saveObjectAttempt, saveObjectUpload } from '../objectUploads';

export const IDLE_UPLOAD_MS = 24 * 60 * 60 * 1000;
const readyToClaim = (a: ObjectAttemptRecord, now: Date) => !a.recovery || (Date.parse(a.recovery.leaseUntil) <= now.getTime() && (!a.recovery.nextRetryAt || Date.parse(a.recovery.nextRetryAt) <= now.getTime()));
const recoveryDue = (now: Date) => sql`coalesce((${objectAttempts.body}->'recovery'->>'leaseUntil')::timestamptz,'epoch') <= ${now.toISOString()}::timestamptz AND coalesce((${objectAttempts.body}->'recovery'->>'nextRetryAt')::timestamptz,'epoch') <= ${now.toISOString()}::timestamptz`;
const claimAttempt = (a: ObjectAttemptRecord, owner: string, now: Date) => ({ ...a, recovery: { owner, sequence: (a.recovery?.sequence ?? 0) + 1, leaseUntil: new Date(now.getTime() + 90_000).toISOString(), nextRetryAt: null, errorCode: null } });
async function owned(db: Executor, claim: ObjectAttemptRecord): Promise<ObjectAttemptRecord | undefined> {
  const a = (await db.select().from(objectAttempts).where(eq(objectAttempts.id, claim.id)))[0]?.body;
  return a?.recovery && a.state === claim.state && a.recovery.owner === claim.recovery?.owner && a.recovery.sequence === claim.recovery.sequence ? a : undefined;
}
async function releaseReservation(db: Executor, upload: ObjectUploadRecord, now: Date): Promise<void> {
  if (upload.state !== 'aborted' || upload.reservationReleasedAt) return;
  const remaining = await db.select({ id: objectAttempts.id }).from(objectAttempts).where(and(eq(objectAttempts.uploadId, upload.id), sql`${objectAttempts.state} <> 'deleted'`)).limit(1);
  if (remaining.length) return;
  const space = await requireObjectSpace(db, upload.spaceId);
  await saveObjectSpace(db, { ...space, reservedBytes: space.reservedBytes - upload.size });
  await saveObjectUpload(db, { ...upload, reservationReleasedAt: now.toISOString() });
}

export function objectRecoveryRepository(db: Database): ObjectRecoveryRepository {
  return {
    ...inspections(db), ...garbage(db),
    expireIdle: () => objectStorageTransaction(db, async (tx, now) => {
      const rows = await tx.select().from(objectUploads).where(and(inArray(objectUploads.state, ['waiting', 'failed', 'verifying', 'aborted']), lte(objectUploads.updatedAt, new Date(now.getTime() - IDLE_UPLOAD_MS)), sql`${objectUploads.body}->>'reservationReleasedAt' IS NULL AND (${objectUploads.body}->>'commitRequested' <> 'true' OR ${objectUploads.body}->>'retryable' <> 'true' OR ${objectUploads.state} = 'aborted')`)).orderBy(objectUploads.id).limit(100);
      let count = 0;
      for (const { body: upload } of rows) {
        if (upload.reservationReleasedAt || (upload.commitRequested && upload.retryable && upload.state !== 'aborted')) continue;
        const attempts = await tx.select().from(objectAttempts).where(eq(objectAttempts.uploadId, upload.id));
        if (attempts.some(({ body: a }) => !a.writerEndedAt || ['streaming', 'verifying'].includes(a.state))) continue;
        try { await assertObjectStorageUnfrozen(tx, (await requireObjectSpace(tx, upload.spaceId)).backendId); }
        catch (error) { if (isPlatformError(error) && error.details.code === 'object_storage_frozen') continue; throw error; }
        const next = { ...upload, state: 'aborted' as const, retryable: false, errorCode: 'object_upload_expired', updatedAt: now.toISOString() };
        if (upload.state !== 'aborted') { await saveObjectUpload(tx, next); count++; }
        await releaseReservation(tx, next, now);
      }
      return count;
    }),
  };
}

function inspections(db: Database): Pick<ObjectRecoveryRepository, 'claimInspection' | 'inspected' | 'deferInspection'> {
  return {
    claimInspection: (owner) => objectStorageTransaction(db, async (tx, now) => {
      const rows = await tx.select().from(objectAttempts).where(and(eq(objectAttempts.state, 'unknown'), sql`${objectAttempts.body}->>'writerEndedAt' IS NULL`, recoveryDue(now))).orderBy(objectAttempts.id).limit(100);
      for (const { body: a } of rows) {
        if (!readyToClaim(a, now) || (await requireObjectBackend(tx, a.backendId)).state === 'offline') continue;
        const claim = claimAttempt(a, owner, now); await saveObjectAttempt(tx, claim); return claim;
      }
      return undefined;
    }),
    inspected: (claim) => objectStorageTransaction(db, async (tx, now) => {
      const a = await owned(tx, claim);
      if (!a || a.state !== 'unknown' || a.writerEndedAt) return false;
      const upload = await requireObjectUpload(tx, a.uploadId), current = upload.currentAttemptId === a.id && !['ready', 'aborted'].includes(upload.state);
      // A unique single-PUT key is visible only after that atomic write commits. HEAD is not digest verification.
      await saveObjectAttempt(tx, { ...a, state: current ? 'uploaded' : 'unknown', writerEndedAt: now.toISOString(), updatedAt: now.toISOString() });
      await changeTransferCount(tx, await requireObjectBackend(tx, a.backendId), await requireObjectSpace(tx, a.spaceId), -1);
      if (current) await saveObjectUpload(tx, { ...upload, state: 'verifying', errorCode: null, updatedAt: now.toISOString() });
      return true;
    }),
    deferInspection: (claim) => defer(db, claim, 'object_writer_unconfirmed'),
  };
}

function garbage(db: Database): Pick<ObjectRecoveryRepository, 'claimGarbage' | 'completeGarbage' | 'failGarbage'> {
  return {
    claimGarbage: (owner) => objectStorageTransaction(db, async (tx, now) => {
      const rows = await tx.select({ body: objectAttempts.body }).from(objectAttempts).innerJoin(objectUploads, eq(objectAttempts.uploadId, objectUploads.id)).where(and(inArray(objectAttempts.state, ['unknown', 'uploaded', 'deleting']), recoveryDue(now),
        sql`${objectAttempts.body}->>'writerEndedAt' IS NOT NULL AND (${objectAttempts.state}='deleting' OR (${objectAttempts.body}->>'updatedAt')::timestamptz <= ${new Date(now.getTime() - IDLE_UPLOAD_MS).toISOString()}::timestamptz)`,
        sql`${objectUploads.body}->>'readyAttemptId' IS DISTINCT FROM ${objectAttempts.id} AND (${objectUploads.body}->>'currentAttemptId' IS DISTINCT FROM ${objectAttempts.id} OR ${objectUploads.state}='aborted')`)).orderBy(objectAttempts.id).limit(100);
      for (const { body: a } of rows) {
        if (!readyToClaim(a, now) || (a.state !== 'deleting' && Date.parse(a.updatedAt) > now.getTime() - IDLE_UPLOAD_MS)) continue;
        const upload = await requireObjectUpload(tx, a.uploadId);
        if (upload.readyAttemptId === a.id || (upload.currentAttemptId === a.id && upload.state !== 'aborted')) continue;
        if ((await requireObjectBackend(tx, a.backendId)).state === 'offline') continue;
        try { await assertObjectStorageUnfrozen(tx, a.backendId); }
        catch (error) { if (!isPlatformError(error) || error.details.code !== 'object_storage_frozen') throw error; if (a.state !== 'deleting') continue; }
        const claim = { ...claimAttempt(a, owner, now), state: 'deleting' as const };
        await saveObjectAttempt(tx, claim); return claim;
      }
      return undefined;
    }),
    completeGarbage: (claim) => objectStorageTransaction(db, async (tx, now) => {
      const a = await owned(tx, claim);
      if (!a || a.state !== 'deleting' || !a.writerEndedAt) return false;
      const upload = await requireObjectUpload(tx, a.uploadId);
      if (upload.readyAttemptId === a.id) return false;
      await saveObjectAttempt(tx, { ...a, state: 'deleted', updatedAt: now.toISOString() });
      const backend = await requireObjectBackend(tx, a.backendId);
      await saveObjectBackend(tx, { ...backend, reservedBytes: backend.reservedBytes - a.size });
      await releaseReservation(tx, upload, now); return true;
    }),
    failGarbage: (claim) => defer(db, claim, 'object_staging_deletion_unconfirmed'),
  };
}

function defer(db: Database, claim: ObjectAttemptRecord, code: string) {
  return objectStorageTransaction(db, async (tx, now) => {
    const a = await owned(tx, claim);
    if (!a?.recovery) return false;
    const delay = Math.min(300_000, 1000 * 2 ** Math.min(a.recovery.sequence, 8));
    await saveObjectAttempt(tx, { ...a, recovery: { ...a.recovery, leaseUntil: now.toISOString(), nextRetryAt: new Date(now.getTime() + delay).toISOString(), errorCode: code } });
    return true;
  });
}
