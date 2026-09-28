import { and, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import type { Database } from '@crewstation/persistence';
import { validation } from '@crewstation/kernel';
import { ResourceIdSchema } from '@crewstation/contracts';
import type { ObjectReadRepository } from '../../ports/objectStorage';
import { finalizationBindings, objectAttempts, objectReadTransfers, objectUploads, storedObjects } from './objectTables';
import { archiveReceiptPage } from './archive/receiptPage';
import { archiveHistory } from './archive/history';

export function objectReadRepository(db: Database): ObjectReadRepository {
  return {
    archiveHistory: archiveHistory(db),
    objects: async (ids) => {
      if (ids.length > 100) throw validation('对象读取批次超过上限');
      if (!ids.length) return [];
      return (await db.select().from(storedObjects).where(inArray(storedObjects.id, [...ids]))).map((r) => r.body);
    },
    receiptPage: archiveReceiptPage(db),
    page: async (spaceId, cursor, limit) => {
      if (cursor && !/^[a-f0-9-]{36}$/.test(cursor)) throw validation('无效的对象列表游标');
      const rows = await db.select().from(storedObjects).where(and(eq(storedObjects.spaceId, spaceId), ne(storedObjects.state, 'deleted'), cursor ? gt(storedObjects.id, cursor) : undefined)).orderBy(storedObjects.id).limit(limit + 1);
      return { items: rows.slice(0, limit).map((r) => r.body), nextCursor: rows.length > limit ? rows[limit - 1]!.id : null };
    },
    object: async (id) => (await db.select().from(storedObjects).where(eq(storedObjects.id, id)))[0]?.body,
    queue: async (spaceIds) => {
      if (!spaceIds.length) return { uploading: 0, verifying: 0, deleting: 0, failed: 0, unknownWrites: 0, activeDownloads: 0, unknownDownloads: 0, pendingBytes: 0, oldestPendingAt: null };
      const [upload] = await db.select({
        uploading: sql<number>`count(*) filter (where ${objectUploads.state} in ('waiting', 'uploading'))::int`,
        verifying: sql<number>`count(*) filter (where ${objectUploads.state} = 'verifying')::int`,
        failed: sql<number>`count(*) filter (where ${objectUploads.state} = 'failed')::int`,
        bytes: sql<string>`coalesce(sum((${objectUploads.body}->>'size')::bigint), 0)::text`,
        oldest: sql<string | null>`min(${objectUploads.body}->>'createdAt')`,
      }).from(objectUploads).where(and(inArray(objectUploads.spaceId, [...spaceIds]), inArray(objectUploads.state, ['waiting', 'uploading', 'verifying', 'failed'])));
      const [deletion] = await db.select({ count: sql<number>`count(*)::int`, bytes: sql<string>`coalesce(sum((${storedObjects.body}->>'size')::bigint), 0)::text`, oldest: sql<string | null>`min(${storedObjects.body}->'deletion'->>'requestedAt')` })
        .from(storedObjects).where(and(inArray(storedObjects.spaceId, [...spaceIds]), eq(storedObjects.state, 'deleting')));
      const [staging] = await db.select({ count: sql<number>`count(*)::int`, bytes: sql<string>`coalesce(sum((${objectAttempts.body}->>'size')::bigint),0)::text`, oldest: sql<string | null>`min(${objectAttempts.body}->>'updatedAt')` }).from(objectAttempts).where(and(inArray(objectAttempts.spaceId, [...spaceIds]), eq(objectAttempts.state, 'deleting')));
      const oldest = [upload?.oldest, deletion?.oldest, staging?.oldest].filter((v): v is string => !!v).sort()[0] ?? null;
      const [unknown] = await db.select({ count: sql<number>`count(*)::int` }).from(objectAttempts).where(and(inArray(objectAttempts.spaceId, [...spaceIds]), eq(objectAttempts.state, 'unknown'), sql`${objectAttempts.body}->>'writerEndedAt' IS NULL`));
      const [downloads] = await db.select({ active: sql<number>`count(*) filter (where (${objectReadTransfers.body}->>'expiresAt')::timestamptz > clock_timestamp())::int`, unknown: sql<number>`count(*) filter (where (${objectReadTransfers.body}->>'expiresAt')::timestamptz <= clock_timestamp())::int` }).from(objectReadTransfers).where(and(inArray(objectReadTransfers.spaceId, [...spaceIds]), sql`${objectReadTransfers.body}->>'endedAt' IS NULL`));
      return { uploading: upload?.uploading ?? 0, verifying: upload?.verifying ?? 0, deleting: (deletion?.count ?? 0) + (staging?.count ?? 0), failed: upload?.failed ?? 0, unknownWrites: unknown?.count ?? 0, activeDownloads: downloads?.active ?? 0, unknownDownloads: downloads?.unknown ?? 0, pendingBytes: Number(upload?.bytes ?? 0) + Number(deletion?.bytes ?? 0) + Number(staging?.bytes ?? 0), oldestPendingAt: oldest };
    },
    blockers: async (spaceIds, limit, cursor) => {
      if (cursor && !ResourceIdSchema.safeParse(cursor).success) throw validation('无效的归档阻塞游标');
      if (!spaceIds.length) return { items: [], nextCursor: null };
      const rows = await db.select().from(finalizationBindings).where(and(inArray(finalizationBindings.spaceId, [...spaceIds]), cursor ? gt(finalizationBindings.id, cursor) : undefined, sql`${finalizationBindings.body}->'observation' IS NOT NULL AND ${finalizationBindings.body}->'observation' <> 'null'::jsonb`)).orderBy(finalizationBindings.id).limit(limit + 1);
      return { items: rows.slice(0, limit).flatMap((r) => r.body.observation ? [r.body.observation] : []), nextCursor: rows.length > limit ? rows[limit - 1]!.id : null };
    },
  };
}
