import { and, asc, desc, eq, gt, lte } from 'drizzle-orm';
import { conflict, gone, newResourceId, notFound, validation } from '@crewstation/kernel';
import type { Database } from '@crewstation/persistence';
import type { UsageSnapshot, UsageSnapshotQuery } from '../../ports/usageLedger';
import { usageChanges, usageHeads, usageSnapshots } from './usageLedgerTables';

const lifetimeMs = 30 * 60 * 1000;
async function snapshotRecord(db: Database, taskKey: string, snapshotId: string | undefined, now: number, visibilityRevision: number) {
  if (snapshotId !== undefined) {
    const row = (await db.select().from(usageSnapshots).where(and(eq(usageSnapshots.id, snapshotId), eq(usageSnapshots.taskKey, taskKey))).limit(1))[0];
    if (!row) throw notFound('用量快照不存在');
    if (row.visibilityRevision !== visibilityRevision) throw conflict('金额可见性已变更，请重新读取快照');
    if (row.expiresAt <= now) throw gone('用量快照已过期，请重新读取');
    return row;
  }
  const through = (await db.select().from(usageHeads).where(eq(usageHeads.taskKey, taskKey)).limit(1))[0]?.sequence ?? 0;
  const row = { id: newResourceId(), taskKey, through, visibilityRevision, createdAt: now, expiresAt: now + lifetimeMs };
  await db.insert(usageSnapshots).values(row);
  return row;
}

/** Read each meter's last committed version at the persisted snapshot boundary.
 * Later corrections and newly-created meters cannot drift into subsequent pages. */
export async function usageSnapshot(db: Database, taskKey: string, query: UsageSnapshotQuery, now: number, visibilityRevision: number): Promise<UsageSnapshot> {
  if (!Number.isSafeInteger(visibilityRevision) || visibilityRevision < 0 || !Number.isSafeInteger(now) || now < 0 || now > Number.MAX_SAFE_INTEGER - lifetimeMs) throw new RangeError('Invalid usage snapshot clock or visibility');
  if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 500 ||
    (query.snapshotId === undefined) !== (query.cursor === undefined) ||
    (query.snapshotId !== undefined && (query.snapshotId.length === 0 || query.snapshotId.length > 512)) ||
    (query.cursor !== undefined && !/^[a-f0-9]{64}$/.test(query.cursor))) throw validation('Invalid usage snapshot page');
  const snapshot = await snapshotRecord(db, taskKey, query.snapshotId, now, visibilityRevision);
  const rows = await db.selectDistinctOn([usageChanges.meterKey], { meterKey: usageChanges.meterKey, document: usageChanges.document })
    .from(usageChanges).where(and(eq(usageChanges.taskKey, taskKey), lte(usageChanges.sequence, snapshot.through),
      query.cursor === undefined ? undefined : gt(usageChanges.meterKey, query.cursor)))
    .orderBy(asc(usageChanges.meterKey), desc(usageChanges.sequence)).limit(query.limit + 1);
  const items = rows.slice(0, query.limit);
  return { snapshotId: snapshot.id, snapshotThrough: snapshot.through, visibilityRevision: snapshot.visibilityRevision, expiresAt: snapshot.expiresAt, createdAt: snapshot.createdAt,
    items: items.map((row) => row.document), nextCursor: rows.length > query.limit ? items.at(-1)!.meterKey : null };
}
