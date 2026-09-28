import { and, eq, inArray, sql } from 'drizzle-orm';
import { conflict, notFound } from '@crewstation/kernel';
import type { Executor } from '@crewstation/persistence';
import type { ObjectReferenceOwner, StoredObjectRecord } from '../../../domain/objectStorage';
import { assertObjectReadable } from '../../../domain/objectStorage';
import { objectReferences, storedObjects } from '../objectTables';

type ArchiveOwner = { type: ObjectReferenceOwner; id: string; revision: number };
export async function archiveObjects(tx: Executor, spaceId: string, objectIds: readonly string[], readable = true): Promise<StoredObjectRecord[]> {
  const ids = [...new Set(objectIds)]; if (!ids.length) return [];
  const objects = (await tx.select().from(storedObjects).where(inArray(storedObjects.id, ids))).map((row) => row.body);
  if (objects.length !== ids.length || objects.some((o) => o.spaceId !== spaceId)) throw notFound('归档对象');
  if (readable) for (const object of objects) assertObjectReadable(object);
  return objects;
}

/** Batch within the metadata transaction: a 10,000-item receipt must not issue 10,000 SQL round trips. */
export async function archiveReferences(tx: Executor, spaceId: string, objectIds: readonly string[], owner: ArchiveOwner, desired: 'active' | 'released', now: Date): Promise<StoredObjectRecord[]> {
  const objects = await archiveObjects(tx, spaceId, objectIds, desired === 'active'); if (!objects.length) return [];
  const key = and(inArray(objectReferences.objectId, objects.map((o) => o.id)), eq(objectReferences.ownerType, owner.type), eq(objectReferences.ownerId, owner.id), eq(objectReferences.revision, owner.revision));
  const existing = new Map((await tx.select().from(objectReferences).where(key)).map((r) => [r.objectId, r.body]));
  if (desired === 'active' && [...existing.values()].some((r) => r.state === 'released')) throw conflict('归档引用版本已被释放');
  const changed = objects.filter((o) => existing.get(o.id)?.state !== desired);
  if (!changed.length) return objects;
  const values = changed.map((object) => {
    const body = { objectId: object.id, ownerType: owner.type, ownerId: owner.id, revision: owner.revision, state: desired, createdAt: existing.get(object.id)?.createdAt ?? now.toISOString() };
    return { objectId: object.id, ownerType: owner.type, ownerId: owner.id, revision: owner.revision, body };
  });
  await tx.insert(objectReferences).values(values).onConflictDoUpdate({ target: [objectReferences.objectId, objectReferences.ownerType, objectReferences.ownerId, objectReferences.revision], set: { body: sql`excluded.body` } });
  const updated = await tx.update(storedObjects).set({ body: sql`jsonb_set(jsonb_set(${storedObjects.body}, '{revision}', to_jsonb((${storedObjects.body}->>'revision')::integer + 1)), '{referenceCount}', to_jsonb((SELECT count(*)::integer FROM ${objectReferences} WHERE ${objectReferences.objectId} = ${storedObjects.id} AND ${objectReferences.body}->>'state' = 'active')))` })
    .where(inArray(storedObjects.id, changed.map((o) => o.id))).returning({ body: storedObjects.body });
  const byId = new Map(updated.map(({ body }) => [body.id, body]));
  return objects.map((o) => byId.get(o.id) ?? o);
}
/** Platform pins are never exposed through the application's reference API. */
export async function archiveReference(tx: Executor, spaceId: string, objectId: string, owner: ArchiveOwner, desired: 'active' | 'released', now: Date): Promise<StoredObjectRecord> {
  return (await archiveReferences(tx, spaceId, [objectId], owner, desired, now))[0]!;
}
