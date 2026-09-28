import { and, eq, inArray, sql } from 'drizzle-orm';
import { conflict, jsonHash, precondition } from '@crewstation/kernel';
import type { Database } from '@crewstation/persistence';
import type { ObjectRestoreRepository } from '../../../ports/objectRestore';
import { objectStorageTransaction, requireObjectBackend, saveObjectBackend } from '../objectCatalog';
import { objectBackends, objectReadTransfers, objectStorageFreezes, objectUploads, storedObjects } from '../objectTables';
import { assertBackupFrozen, assertRestoreTarget, requireBackup, saveBackup } from './backups';

export function objectRestoreRepository(db: Database): ObjectRestoreRepository {
  return {
    placements: (id) => objectStorageTransaction(db, async (tx) => {
      await assertRestoreTarget(tx, id); const record = await requireBackup(tx, id); await assertBackupFrozen(tx, record);
      if (record.restoreTarget) return record.restoreTarget.placements;
      const backends = await tx.select().from(objectBackends), placements = [];
      for (const { body: backend } of backends) {
        const [max] = await tx.select({ revision: sql<number>`max((${storedObjects.body}->>'placementRevision')::int)` }).from(storedObjects).where(sql`${storedObjects.body}->>'backendId'=${backend.id}`);
        const targetRevision = Math.max(backend.placementRevision, max?.revision ?? 0) + 1;
        const sources = await tx.selectDistinct({ revision: sql<number>`(${storedObjects.body}->>'placementRevision')::int` }).from(storedObjects).where(and(sql`${storedObjects.body}->>'backendId'=${backend.id}`, inArray(storedObjects.state, ['ready', 'degraded'])));
        for (const revision of new Set([backend.placementRevision, ...sources.map((r) => r.revision)])) placements.push({ backendId: backend.id, sourceRevision: revision, targetRevision });
      }
      return placements;
    }),
    prepare: (id, requestKey, digest, placements, apply) => objectStorageTransaction(db, async (tx, now) => {
      await assertRestoreTarget(tx, id); const record = await requireBackup(tx, id); await assertBackupFrozen(tx, record);
      if (record.restoreTarget) {
        if (record.restoreTarget.digest !== digest || record.restoreTarget.requestKey !== requestKey || jsonHash(record.restoreTarget.placements) !== jsonHash(placements)) throw conflict('恢复目标已经固定，不能换目的地或备份');
        return record;
      }
      if (!['exporting', 'restore-verified'].includes(record.state)) throw precondition('恢复只接受原备份快照中的冻结记录');
      await apply(tx);
      const next = { ...record, restoreTarget: { requestKey, digest, placements, startedAt: now.toISOString() }, updatedAt: now.toISOString() };
      await saveBackup(tx, next); return next;
    }),
    activate: (id, digest, manifestDigest, objectCount, bytes) => activateRestore(db, id, digest, manifestDigest, objectCount, bytes),
  };
}
async function activateRestore(db: Database, id: string, digest: string, manifestDigest: string, objectCount: number, bytes: number): Promise<void> {
  await objectStorageTransaction(db, async (tx, now) => {
    await assertRestoreTarget(tx, id); const record = await requireBackup(tx, id), target = record.restoreTarget;
    if (!target || target.digest !== digest) throw conflict('恢复目标不匹配');
    if (target.activatedAt) return;
    await assertBackupFrozen(tx, record);
    const [actual] = await tx.select({ count: sql<number>`count(*)::int`, bytes: sql<string>`coalesce(sum((body->>'size')::bigint),0)::text` }).from(storedObjects).where(inArray(storedObjects.state, ['ready', 'degraded']));
    if (actual?.count !== objectCount || Number(actual?.bytes) !== bytes) throw conflict('恢复对象集合已变化');
    for (const placement of target.placements) {
      await tx.execute(sql`UPDATE data.objects SET state='ready', body=body || jsonb_build_object('state','ready','message',null,'revision',(body->>'revision')::int+1,'placementRevision',${placement.targetRevision}::int,'key','restores/' || ${id}::text || '/' || id || '/' || (body->>'sha256')) WHERE state IN ('ready','degraded') AND body->>'backendId'=${placement.backendId} AND (body->>'placementRevision')::int=${placement.sourceRevision}`);
    }
    await tx.execute(sql`UPDATE data.object_upload_attempts a SET body=a.body || jsonb_build_object('placementRevision',(o.body->>'placementRevision')::int,'key',o.body->>'key') FROM data.objects o WHERE o.state='ready' AND o.body->>'attemptId'=a.id`);
    // Old in-flight temporary bytes are not in the archive and do not exist at the independent destination.
    await tx.execute(sql`UPDATE data.object_upload_attempts SET state='deleted', body=body || jsonb_build_object('state','deleted','writerEndedAt',${now.toISOString()}::text) WHERE id NOT IN (SELECT body->>'attemptId' FROM data.objects WHERE state='ready')`);
    await tx.update(objectUploads).set({ state: 'aborted', body: sql`${objectUploads.body} || jsonb_build_object('state','aborted','retryable',false,'errorCode','object_restore_staging_discarded','reservationReleasedAt',${now.toISOString()}::text)` }).where(sql`${objectUploads.state} <> 'ready'`);
    await tx.update(storedObjects).set({ state: 'deleted', body: sql`${storedObjects.body} || '{"state":"deleted"}'::jsonb` }).where(eq(storedObjects.state, 'deleting'));
    await tx.update(objectReadTransfers).set({ body: sql`${objectReadTransfers.body} || jsonb_build_object('endedAt',${now.toISOString()}::text)` }).where(sql`${objectReadTransfers.body}->>'endedAt' IS NULL`);
    for (const backendId of new Set(target.placements.map((p) => p.backendId))) {
      const backend = await requireObjectBackend(tx, backendId), placement = target.placements.find((p) => p.backendId === backendId)!;
      if (!placement.endpoint || !placement.bucket || !placement.region) throw precondition('恢复目标位置不完整');
      const [usage] = await tx.select({ bytes: sql<string>`coalesce(sum((body->>'size')::bigint),0)::text` }).from(storedObjects).where(and(eq(storedObjects.state, 'ready'), sql`body->>'backendId'=${backendId}`));
      await saveObjectBackend(tx, { ...backend, endpoint: placement.endpoint, region: placement.region, bucket: placement.bucket, placementRevision: placement.targetRevision, credentialRevision: 1, revision: backend.revision + 1, activeTransfers: 0, reservedBytes: Number(usage?.bytes), health: 'ready', durability: 'dev-only', durabilityVerifiedAt: null, physicalFreeBytes: null, physicalTotalBytes: null, observedAt: null, physicalObservedAt: null });
    }
    await tx.execute(sql`UPDATE data.object_spaces s SET body=s.body || jsonb_build_object('health','ready','activeTransfers',0,'reservedBytes',0,'deletingBytes',0,'usedBytes',(SELECT coalesce(sum((o.body->>'size')::bigint),0) FROM data.objects o WHERE o.space_id=s.id AND o.state='ready'),'objectCount',(SELECT count(*) FROM data.objects o WHERE o.space_id=s.id AND o.state='ready'))`);
    await saveBackup(tx, { ...record, state: 'restored', objectCount, bytes, restoreManifestDigest: manifestDigest, restoreVerifiedAt: now.toISOString(), restoreTarget: { ...target, activatedAt: now.toISOString() }, updatedAt: now.toISOString(), completedAt: now.toISOString() });
    await tx.update(objectStorageFreezes).set({ body: { id, backendId: null, kind: 'backup', epoch: record.epoch, active: false } }).where(eq(objectStorageFreezes.id, id));
  });
}
