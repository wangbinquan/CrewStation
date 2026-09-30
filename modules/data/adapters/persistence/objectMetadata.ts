import { eq, sql } from 'drizzle-orm';
import type { Database, Executor, Transaction } from '@crewstation/persistence';
import { notFound, PlatformError, precondition } from '@crewstation/kernel';
import type { ObjectBackendRecord, ObjectSource, ObjectSpaceRecord } from '../../domain/objectStorage';
import { assertStorageWrite } from '../../domain/objectStorage';
import { objectBackends, objectSpaces, objectStorageFreezes, objectWriteControls } from './objectTables';

/** Only short metadata transactions use this lock; never perform byte-store calls inside it. */
export async function objectStorageTransaction<T>(db: Database, work: (tx: Transaction, now: Date) => Promise<T>): Promise<T> {
  const deadline = Date.now() + 2000;
  do {
    const result = await db.transaction(async (tx) => {
      const [lock] = await tx.execute<{ acquired: boolean }>(sql`SELECT pg_try_advisory_xact_lock(hashtextextended('data.object-storage', 0)) AS acquired`);
      if (!lock?.acquired) return { acquired: false as const };
      const [time] = await tx.execute<{ now: string }>(sql`SELECT clock_timestamp()::text AS now`);
      return { acquired: true as const, value: await work(tx, new Date(time!.now)) };
    });
    if (result.acquired) return result.value;
    await Bun.sleep(10);
  } while (Date.now() < deadline);
  throw new PlatformError('unavailable', '存储元数据正在变更，请重试', { code: 'object_storage_busy' });
}

export async function requireObjectBackend(db: Executor, id: string): Promise<ObjectBackendRecord> {
  const row = (await db.select().from(objectBackends).where(eq(objectBackends.id, id)))[0];
  if (!row) throw notFound('对象存储后端', id);
  return row.body;
}
export async function requireObjectSpace(db: Executor, id: string): Promise<ObjectSpaceRecord> {
  const row = (await db.select().from(objectSpaces).where(eq(objectSpaces.id, id)))[0];
  if (!row) throw notFound('对象空间', id);
  return row.body;
}
export async function assertObjectStorageUnfrozen(db: Executor, backendId: string): Promise<void> {
  const frozen = (await db.select().from(objectStorageFreezes)).some(({ body }) => body.active && (body.backendId === null || body.backendId === backendId));
  if (frozen) throw precondition('对象存储正在备份或迁移，写操作暂时冻结', { code: 'object_storage_frozen' });
}
export async function authorizeObjectWrite(db: Executor, space: ObjectSpaceRecord, source: ObjectSource, fence: Parameters<typeof assertStorageWrite>[1], now: Date): Promise<void> {
  if (space.projectId !== source.projectId || space.serviceId !== source.serviceId || space.env !== source.env) throw notFound('对象空间');
  if (source.writeAllowed === false) throw precondition('来源项目已停止新写入', { code: 'object_project_read_only' });
  await assertObjectStorageUnfrozen(db, space.backendId);
  const row = (await db.select().from(objectWriteControls).where(eq(objectWriteControls.serviceId, source.serviceId)))[0];
  assertStorageWrite(row?.body, fence, source.fenced, now, source.podUid);
}
export async function saveObjectSpace(db: Executor, space: ObjectSpaceRecord): Promise<void> {
  await db.update(objectSpaces).set({ body: space }).where(eq(objectSpaces.id, space.id));
}
export async function saveObjectBackend(db: Executor, backend: ObjectBackendRecord): Promise<void> {
  await db.update(objectBackends).set({ body: backend }).where(eq(objectBackends.id, backend.id));
}
