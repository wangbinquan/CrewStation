import type { ArchiveLossItem, ArchiveReceiptItem } from '@crewstation/contracts';
import { and, eq, inArray } from 'drizzle-orm';
import type { Executor } from '@crewstation/persistence';
import type { FinalizationBinding } from '../../../domain/objectStorage';
import { storedObjects } from '../objectTables';
import { requireArchivePlan } from './plans';
import { archiveFileResults } from './helperTables';
import { jsonHash } from '@crewstation/kernel';

/** Metadata evidence only. An unknown or degraded object never becomes saved because an operator accepts loss. */
export async function archiveLossSnapshot(tx: Executor, binding: FinalizationBinding) {
  const entries = binding.planId ? (await requireArchivePlan(tx, binding.planId)).entries : [];
  const files = new Map((await tx.select().from(archiveFileResults).where(and(eq(archiveFileResults.bindingId, binding.id), eq(archiveFileResults.revision, binding.revision)))).map(({ body }) => [body.path, body.item]));
  const ids = [...new Set(entries.flatMap((entry) => { const file = entry.kind === 'file' ? files.get(entry.path) : undefined; return entry.kind === 'object' ? [entry.objectId] : file?.state === 'saved' ? [file.objectId] : []; }))];
  const objects = new Map((ids.length ? await tx.select().from(storedObjects).where(inArray(storedObjects.id, ids)) : []).map(({ body }) => [body.id, body]));
  const items: ArchiveLossItem[] = entries.map((entry) => {
    const result = entry.kind === 'file' ? files.get(entry.path) : undefined, objectId = entry.kind === 'object' ? entry.objectId : result?.state === 'saved' ? result.objectId : null;
    const object = objectId ? objects.get(objectId) : undefined;
    let item: ArchiveReceiptItem;
    if (object?.state === 'ready' && object.verifiedAt && object.spaceId === binding.spaceId && (entry.kind === 'object' || result?.state === 'saved' && result.sha256 === object.sha256 && result.size === object.size)) item = { state: 'saved', name: entry.name, objectId: object.id, size: object.size, sha256: object.sha256 };
    else if (entry.kind === 'file' && !entry.required && result?.state === 'omitted') item = { ...result, name: entry.name };
    else item = { state: 'lost', name: entry.name, reason: object ? '对象不可读或完整性未确认' : '文件尚未归档或对象缺失' };
    return { item, path: entry.kind === 'file' ? entry.path : null, sourceObjectId: objectId, referenceCount: object?.referenceCount ?? null };
  });
  return { items, digest: jsonHash({ id: binding.id, revision: binding.revision, volumeUid: binding.volumeUid, manifestDigest: binding.manifestDigest, items }) };
}
