import { assertTransferOwnerActive } from './objects/transferOwnerState';
import { and, eq, sql } from 'drizzle-orm';
import { OBJECT_STORAGE_LIMITS } from '@crewstation/contracts';
import type { Database, Executor } from '@crewstation/persistence';
import { conflict, isPlatformError, jsonHash, notFound, precondition } from '@crewstation/kernel';
import { assertObjectDeletable, assertObjectReadable, assertSameStorageRequest, assertStorageRevision } from '../../domain/objectStorage';
import type { ObjectMutation, ObjectReadTransfer, ObjectSource, StoredObjectRecord } from '../../domain/objectStorage';
import type { ObjectContentRepository } from '../../ports/objectContent';
import { assertObjectStorageUnfrozen, authorizeObjectWrite, objectStorageTransaction, requireObjectBackend, requireObjectSpace, saveObjectBackend, saveObjectSpace } from './objectCatalog';
import { objectAttempts, objectMutations, objectReadTransfers, objectReferences, storedObjects } from './objectTables';
import { assertTransferCapacity, changeTransferCount, DEFAULT_OBJECT_TRANSFER_LIMITS } from './objectUploads';
import type { ObjectRequestRunner } from '../../ports/deletion/objectWork';

export async function requireStoredObject(db: Executor, id: string): Promise<StoredObjectRecord> {
  const object = (await db.select().from(storedObjects).where(eq(storedObjects.id, id)))[0]?.body;
  if (!object) throw notFound('对象'); return object;
}
export async function saveStoredObject(db: Executor, object: StoredObjectRecord): Promise<void> {
  await db.update(storedObjects).set({ state: object.state, body: object }).where(eq(storedObjects.id, object.id));
}
async function repeatedMutation(db: Executor, input: ObjectMutation): Promise<boolean> {
  const old = (await db.select().from(objectMutations).where(and(eq(objectMutations.spaceId, input.spaceId), eq(objectMutations.requestKey, input.requestKey))))[0]?.body;
  if (old) { assertSameStorageRequest(old.digest, input.digest); return true; }
  await db.insert(objectMutations).values({ spaceId: input.spaceId, requestKey: input.requestKey, body: input }); return false;
}
async function activeReferences(db: Executor, id: string): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(objectReferences).where(and(eq(objectReferences.objectId, id), sql`${objectReferences.body}->>'state' = 'active'`));
  return row?.count ?? 0;
}
async function pendingReads(db: Executor, id: string): Promise<boolean> {
  return (await db.select({ id: objectReadTransfers.id }).from(objectReadTransfers).where(and(eq(objectReadTransfers.objectId, id), sql`${objectReadTransfers.body}->>'endedAt' IS NULL`)).limit(1)).length > 0;
}

export function objectContentRepository(db: Database, requests?: ObjectRequestRunner): ObjectContentRepository {
  return {
    ...(requests ? { withRead: async <T>(id: string, source: ObjectSource, effect: () => Promise<T>) => {
      const object = await db.transaction(async tx => {
        const original = await requireStoredObject(tx,id), space = await requireObjectSpace(tx,original.spaceId);
        if (space.projectId !== source.projectId || space.serviceId !== source.serviceId || space.env !== source.env) throw notFound('对象');
        assertObjectReadable(original); return original;
      }, { isolationLevel: 'repeatable read',accessMode: 'read only' });
      return requests.run(object,'get',effect);
    } } : {}),
    reference: (id, input, desired, authority) => objectStorageTransaction(db, async (tx, now) => {
      const object = await requireStoredObject(tx, id), space = await requireObjectSpace(tx, object.spaceId);
      await authorizeObjectWrite(tx, space, authority.source, authority.fence, now);
      const { fence: _fence, ...request } = input;
      if (await repeatedMutation(tx, { spaceId: space.id, requestKey: input.requestKey, objectId: id, digest: jsonHash({ id, desired, ...request }) })) return object;
      const key = and(eq(objectReferences.objectId, id), eq(objectReferences.ownerType, input.ownerType), eq(objectReferences.ownerId, input.ownerId), eq(objectReferences.revision, input.revision));
      const old = (await tx.select().from(objectReferences).where(key))[0]?.body;
      if (desired === 'active') {
        assertObjectReadable(object);
        if (old?.state === 'released') throw conflict('此引用版本已经释放，请使用新的版本', { code: 'object_reference_retired' });
      }
      if (old?.state === desired) return object;
      const record = { objectId: id, ownerType: input.ownerType, ownerId: input.ownerId, revision: input.revision, state: desired, createdAt: old?.createdAt ?? now.toISOString() };
      await tx.insert(objectReferences).values({ ...record, body: record }).onConflictDoUpdate({ target: [objectReferences.objectId, objectReferences.ownerType, objectReferences.ownerId, objectReferences.revision], set: { body: record } });
      const next = { ...object, referenceCount: await activeReferences(tx, id), revision: object.revision + 1 };
      await saveStoredObject(tx, next); return next;
    }),
    delete: (id, input, authority) => objectStorageTransaction(db, async (tx, now) => {
      const object = await requireStoredObject(tx, id), space = await requireObjectSpace(tx, object.spaceId);
      await authorizeObjectWrite(tx, space, authority.source, authority.fence, now);
      const { fence: _fence, ...request } = input;
      if (await repeatedMutation(tx, { spaceId: space.id, requestKey: input.requestKey, objectId: id, digest: jsonHash({ action: 'delete', id, ...request }) })) return object;
      assertStorageRevision(object.revision, input.expectedRevision); assertObjectDeletable(object, await activeReferences(tx, id));
      const next: StoredObjectRecord = { ...object, state: 'deleting', revision: object.revision + 1, deletion: { requestedAt: now.toISOString(), owner: null, leaseUntil: null, sequence: 0, nextRetryAt: null, errorCode: null } };
      await saveStoredObject(tx, next);
      await saveObjectSpace(tx, { ...space, usedBytes: space.usedBytes - object.size, deletingBytes: space.deletingBytes + object.size });
      return next;
    }),
    ...objectDownloads(db),
    ...objectDeletions(db),
    markDegraded: (id, reason) => objectStorageTransaction(db, async (tx) => {
      const object = await requireStoredObject(tx, id);
      if (object.state !== 'ready') return;
      await saveStoredObject(tx, { ...object, state: 'degraded', revision: object.revision + 1, message: reason });
      const space = await requireObjectSpace(tx, object.spaceId);
      await saveObjectSpace(tx, { ...space, health: 'degraded' });
    }),
  };
}

function objectDownloads(db: Database): Pick<ObjectContentRepository, 'acquireRead' | 'releaseRead'> {
  return {
    acquireRead: (id, transferId, owner, source) => objectStorageTransaction(db, async (tx, now) => {
      await assertTransferOwnerActive(tx, owner);
      const object = await requireStoredObject(tx, id), space = await requireObjectSpace(tx, object.spaceId), backend = await requireObjectBackend(tx, space.backendId);
      if (space.projectId !== source.projectId || space.serviceId !== source.serviceId || space.env !== source.env) throw notFound('对象');
      assertObjectReadable(object);
      if (backend.state === 'offline') throw precondition('对象后端已停用');
      await assertTransferCapacity(tx, backend, space, DEFAULT_OBJECT_TRANSFER_LIMITS);
      const transfer: ObjectReadTransfer = { id: transferId, objectId: id, spaceId: space.id, backendId: backend.id, owner, expiresAt: new Date(now.getTime() + OBJECT_STORAGE_LIMITS.transferSeconds * 1000).toISOString(), endedAt: null };
      await tx.insert(objectReadTransfers).values({ id: transferId, objectId: id, spaceId: space.id, backendId: backend.id, body: transfer });
      await changeTransferCount(tx, backend, space, 1); return { object, transfer };
    }),
    releaseRead: (id, owner) => objectStorageTransaction(db, async (tx, now) => {
      const transfer = (await tx.select().from(objectReadTransfers).where(eq(objectReadTransfers.id, id)))[0]?.body;
      if (!transfer || transfer.owner !== owner || transfer.endedAt) return false;
      await tx.update(objectReadTransfers).set({ body: { ...transfer, endedAt: now.toISOString() } }).where(eq(objectReadTransfers.id, id));
      await changeTransferCount(tx, await requireObjectBackend(tx, transfer.backendId), await requireObjectSpace(tx, transfer.spaceId), -1); return true;
    }),
  };
}

function objectDeletions(db: Database): Pick<ObjectContentRepository, 'claimDelete' | 'completeDelete' | 'failDelete'> {
  return {
    claimDelete: (owner) => objectStorageTransaction(db, async (tx, now) => {
      const candidates = await tx.select().from(storedObjects).where(eq(storedObjects.state, 'deleting')).orderBy(storedObjects.id).limit(100);
      for (const { body: object } of candidates) {
        const d = object.deletion;
        if (!d || (d.leaseUntil && Date.parse(d.leaseUntil) > now.getTime()) || (d.nextRetryAt && Date.parse(d.nextRetryAt) > now.getTime())) continue;
        if ((await requireObjectBackend(tx, object.backendId)).state === 'offline' || await pendingReads(tx, object.id) || await activeReferences(tx, object.id)) continue;
        try { await assertObjectStorageUnfrozen(tx, object.backendId); } catch (error) {
          if (!isPlatformError(error) || error.details.code !== 'object_storage_frozen') throw error;
          // Only an already issued, idempotent physical deletion may drain during backup freeze.
          if (d.sequence === 0) continue;
        }
        const next = { ...object, deletion: { ...d, owner, sequence: d.sequence + 1, leaseUntil: new Date(now.getTime() + 90_000).toISOString() } };
        await saveStoredObject(tx, next); return next;
      }
      return undefined;
    }),
    completeDelete: (claim) => objectStorageTransaction(db, async (tx, now) => {
      const object = await requireStoredObject(tx, claim.id);
      if (!ownsDeletion(object, claim)) return false;
      const space = await requireObjectSpace(tx, object.spaceId), backend = await requireObjectBackend(tx, object.backendId);
      await saveStoredObject(tx, { ...object, state: 'deleted', revision: object.revision + 1, deletion: { ...object.deletion!, leaseUntil: null, errorCode: null } });
      await saveObjectSpace(tx, { ...space, deletingBytes: space.deletingBytes - object.size, objectCount: space.objectCount - 1 });
      await saveObjectBackend(tx, { ...backend, reservedBytes: backend.reservedBytes - object.size });
      const attempt = (await tx.select().from(objectAttempts).where(eq(objectAttempts.id, object.attemptId)))[0]?.body;
      if (attempt) await tx.update(objectAttempts).set({ state: 'deleted', body: { ...attempt, state: 'deleted', updatedAt: now.toISOString() } }).where(eq(objectAttempts.id, attempt.id));
      return true;
    }),
    failDelete: (claim, errorCode) => objectStorageTransaction(db, async (tx, now) => {
      const object = await requireStoredObject(tx, claim.id);
      if (!ownsDeletion(object, claim)) return false;
      const delay = Math.min(300_000, 1000 * 2 ** Math.min(object.deletion!.sequence, 8));
      await saveStoredObject(tx, { ...object, deletion: { ...object.deletion!, leaseUntil: null, nextRetryAt: new Date(now.getTime() + delay).toISOString(), errorCode } }); return true;
    }),
  };
}
function ownsDeletion(object: StoredObjectRecord, claim: StoredObjectRecord): boolean {
  return object.state === 'deleting' && !!object.deletion?.owner && object.deletion.owner === claim.deletion?.owner && object.deletion.sequence === claim.deletion.sequence;
}
