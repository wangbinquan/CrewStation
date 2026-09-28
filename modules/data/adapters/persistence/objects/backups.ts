import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { conflict, jsonHash, newResourceId, notFound, precondition } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import type { ObjectBackupRecord } from '@crewstation/contracts';
import type { ObjectBackupRepository, StoredBackup } from '../../../ports/objectBackups';
import { assertSameStorageRequest } from '../../../domain/objectStorage';
import { objectStorageTransaction } from '../objectCatalog';
import { objectFreezeStatus } from '../objectFreeze';
import { jsonDocument } from '@crewstation/persistence';
import { dataSchema } from '../schema';
import { objectBackends, objectStorageFreezes, storedObjects } from '../objectTables';
import { text } from 'drizzle-orm/pg-core';

export const objectBackups = dataSchema.table('object_backups', {
  id: text('id').primaryKey(), requestKey: text('request_key').notNull(), state: text('state').notNull(),
  body: jsonDocument('body').$type<StoredBackup>().notNull(),
});
export async function requireBackup(tx: Executor, id: string): Promise<StoredBackup> {
  const row = (await tx.select().from(objectBackups).where(eq(objectBackups.id, id)))[0]?.body;
  if (!row) throw notFound('对象备份'); return row;
}
export async function saveBackup(tx: Executor, record: StoredBackup) {
  await tx.update(objectBackups).set({ state: record.state, body: record }).where(eq(objectBackups.id, record.id));
}
function dto(record: StoredBackup): ObjectBackupRecord {
  const { restoreTarget: _target, sourceDatabaseIdentity: _source, requestKey: _key, requestDigest: _digest, backendIds: _backends, epoch: _epoch, restoreVerifiedAt: _verified, restoreManifestDigest: _restoreDigest, ...value } = record; return value;
}
export async function assertBackupFrozen(tx: Executor, record: StoredBackup) {
  const freeze = await objectFreezeStatus(tx, record.id);
  if (freeze.phase !== 'frozen' || freeze.epoch !== record.epoch) throw precondition('备份尚未排空在途写入和删除', { code: 'object_backup_draining', blockers: freeze.blockers });
}
export function objectBackupRepository(db: Database): ObjectBackupRepository {
  return {
    begin: (input) => objectStorageTransaction(db, async (tx, now) => {
      const previous = (await tx.select().from(objectBackups).where(eq(objectBackups.requestKey, input.requestKey)))[0]?.body;
      if (previous) { assertSameStorageRequest(previous.requestDigest, jsonHash(input)); return previous; }
      if ((await tx.select().from(objectBackups).where(inArray(objectBackups.state, ['draining', 'exporting'])).limit(1)).length) throw conflict('已有对象备份在执行，请继续或明确终止原操作');
      if ((await tx.select().from(objectStorageFreezes).where(sql`${objectStorageFreezes.body}->>'kind'='backup' AND (${objectStorageFreezes.body}->>'active')::boolean`).limit(1)).length) throw conflict('备份或恢复冻结尚未解除');
      const record: StoredBackup = { ...input, sourceDatabaseIdentity: await databaseIdentity(tx), id: newResourceId(), requestDigest: jsonHash(input), backendIds: (await tx.select({ id: objectBackends.id }).from(objectBackends)).map((row) => row.id), epoch: 1,
        state: 'draining', startedAt: now.toISOString(), updatedAt: now.toISOString(), completedAt: null, objectCount: 0, bytes: 0, manifestDigest: null, errorCode: null };
      await tx.insert(objectBackups).values({ id: record.id, requestKey: record.requestKey, state: record.state, body: record });
      await tx.insert(objectStorageFreezes).values({ id: record.id, body: { id: record.id, backendId: null, kind: 'backup', epoch: record.epoch, active: true } });
      return record;
    }),
    get: (id) => requireBackup(db, id),
    start: (id) => objectStorageTransaction(db, async (tx, now) => {
      const record = await requireBackup(tx, id);
      if (record.state !== 'draining') throw conflict('备份已被执行；不能并发重跑，请检查原执行或显式终止');
      await assertBackupFrozen(tx, record);
      const [dangling] = await tx.execute<{ count: number }>(sql`SELECT count(*)::int AS count FROM data.object_references r LEFT JOIN data.objects o ON o.id=r.object_id WHERE r.body->>'state'='active' AND (o.id IS NULL OR o.state NOT IN ('ready','degraded'))`);
      if (dangling?.count) throw precondition('对象引用不完整，禁止创建成功备份', { code: 'object_backup_incomplete' });
      const next = { ...record, state: 'exporting' as const, updatedAt: now.toISOString() }; await saveBackup(tx, next); return next;
    }),
    page: (id, cursor) => objectStorageTransaction(db, async (tx) => {
      const record = await requireBackup(tx, id); await assertRestoreReadable(tx, record);
      return (await tx.select().from(storedObjects).where(and(inArray(storedObjects.state, ['ready', 'degraded']), cursor ? gt(storedObjects.id, cursor) : undefined)).orderBy(storedObjects.id).limit(100)).map((r) => r.body);
    }),
    progress: (id, objectCount, bytes) => objectStorageTransaction(db, async (tx, now) => {
      const record = await requireBackup(tx, id); await assertExporting(tx, record);
      if (objectCount < record.objectCount || bytes < record.bytes) throw conflict('备份进度不可倒退');
      await saveBackup(tx, { ...record, objectCount, bytes, updatedAt: now.toISOString() });
    }),
    finish: (id, result) => finishBackup(db, id, result),
    observe: (backendId) => observeBackups(db, backendId),
    verifyRestored: (id, manifestDigest, objectCount, bytes) => verifyRestored(db, id, manifestDigest, objectCount, bytes),
    assertRestoreTarget: (id) => assertRestoreTarget(db, id),
  };
}
async function assertExporting(tx: Executor, record: StoredBackup) {
  if (record.state !== 'exporting') throw conflict('备份已结束或尚未开始'); await assertBackupFrozen(tx, record);
}
async function finishBackup(db: Database, id: string, result: Parameters<ObjectBackupRepository['finish']>[1]) {
  return objectStorageTransaction(db, async (tx, now) => {
    const record = await requireBackup(tx, id), success = 'manifestDigest' in result;
    if (record.sourceDatabaseIdentity !== await databaseIdentity(tx)) throw precondition('恢复库的写冻结只能在完整恢复核验后解除');
    if (!['draining', 'exporting'].includes(record.state)) {
      if (success && record.state === 'succeeded' && record.manifestDigest === result.manifestDigest && record.objectCount === result.objectCount && record.bytes === result.bytes) return record;
      if (!success && record.errorCode === result.errorCode) return record;
      throw conflict('备份结果已经确定');
    }
    if (success) {
      await assertExporting(tx, record);
      const [actual] = await tx.select({ count: sql<number>`count(*)::int`, bytes: sql<string>`coalesce(sum((${storedObjects.body}->>'size')::bigint),0)::text` }).from(storedObjects).where(inArray(storedObjects.state, ['ready', 'degraded']));
      if (!/^[a-f0-9]{64}$/.test(result.manifestDigest) || actual?.count !== result.objectCount || Number(actual?.bytes) !== result.bytes || record.objectCount !== result.objectCount || record.bytes !== result.bytes) throw precondition('备份清单与冻结元数据不一致');
    }
    const next: StoredBackup = { ...record, state: success ? 'succeeded' : result.errorCode === 'operator_aborted' ? 'aborted' : 'failed', updatedAt: now.toISOString(), completedAt: now.toISOString(), ...(success ? result : { errorCode: result.errorCode }) };
    await saveBackup(tx, next);
    await tx.update(objectStorageFreezes).set({ body: { id: record.id, backendId: null, kind: 'backup', epoch: record.epoch, active: false } }).where(eq(objectStorageFreezes.id, id));
    return next;
  });
}
async function observeBackups(db: Database, backendId: string) {
  const scope = sql`${objectBackups.body}->'backendIds' ? ${backendId}`;
  const latest = (await db.select().from(objectBackups).where(scope).orderBy(desc(objectBackups.id)).limit(1))[0]?.body;
  const succeeded = (await db.select().from(objectBackups).where(and(scope, eq(objectBackups.state, 'succeeded'))).orderBy(desc(objectBackups.id)).limit(1))[0]?.body;
  const restored = (await db.select().from(objectBackups).where(and(scope, sql`${objectBackups.body}->>'restoreVerifiedAt' IS NOT NULL`)).orderBy(sql`${objectBackups.body}->>'restoreVerifiedAt' DESC`).limit(1))[0]?.body;
  return { latest: latest ? dto(latest) : null, lastSucceededAt: succeeded?.completedAt ?? null, lastRestoreVerifiedAt: restored?.restoreVerifiedAt ?? null };
}
async function verifyRestored(db: Database, id: string, manifestDigest: string, objectCount: number, bytes: number) {
  await objectStorageTransaction(db, async (tx, now) => {
    await assertRestoreTarget(tx, id);
    const record = await requireBackup(tx, id); await assertRestoreReadable(tx, record);
    const [actual] = await tx.select({ count: sql<number>`count(*)::int`, bytes: sql<string>`coalesce(sum((${storedObjects.body}->>'size')::bigint),0)::text` }).from(storedObjects).where(inArray(storedObjects.state, ['ready', 'degraded']));
    if (!/^[a-f0-9]{64}$/.test(manifestDigest) || actual?.count !== objectCount || Number(actual?.bytes) !== bytes) throw precondition('恢复清单与冻结元数据不一致');
    await saveBackup(tx, { ...record, state: 'restore-verified', restoreVerifiedAt: now.toISOString(), restoreManifestDigest: manifestDigest, updatedAt: now.toISOString() });
  });
}
export async function databaseIdentity(tx: Executor): Promise<string> {
  const [row] = await tx.execute<{ identity: string }>(sql`SELECT (SELECT system_identifier::text FROM pg_control_system()) || ':' || (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS identity`);
  if (!row?.identity) throw precondition('无法确认备份数据库身份'); return row.identity;
}
export async function assertRestoreTarget(tx: Executor, id: string) {
  const record = await requireBackup(tx, id);
  if (!record.sourceDatabaseIdentity || record.sourceDatabaseIdentity === await databaseIdentity(tx)) throw precondition('恢复核验必须在独立恢复数据库执行，不能操作原备份数据库', { code: 'object_restore_source_database' });
}

async function assertRestoreReadable(tx: Executor, record: StoredBackup) {
  if (!['exporting', 'restore-verified'].includes(record.state)) throw conflict('备份已结束或恢复已完成');
  await assertBackupFrozen(tx, record);
}
