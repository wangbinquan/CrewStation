import { and, asc, desc, eq, gt, lte, sql } from 'drizzle-orm';
import { conflict, gone, newResourceId, notFound, validation } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import type { UsageExecutionIdentity } from '@crewstation/contracts';
import { nativeCaptureId } from '../../domain/usageProjection';
import type { UsageSnapshot, UsageSnapshotQuery } from '../../ports/usageLedger';
import { nativeCaptureHistory, usageChanges, usageHeads, usageSnapshots } from './usageLedgerTables';

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
    items: items.map((row) => row.document), captureIncomplete: await captureIncompleteAt(db, taskKey, snapshot.through), nextCursor: rows.length > query.limit ? items.at(-1)!.meterKey : null };
}

/** Completeness is read from immutable proof history at the same numeric watermark.
 * Distinct turns prevent a later complete turn from hiding an earlier missing proof. */
export async function captureIncompleteAt(db: Executor, taskKey: string, through: number): Promise<boolean> {
  const captures = await db.selectDistinctOn([nativeCaptureHistory.captureId], { id: nativeCaptureHistory.captureId, document: nativeCaptureHistory.document })
    .from(nativeCaptureHistory).where(and(eq(nativeCaptureHistory.taskKey, taskKey), lte(nativeCaptureHistory.sequence, through)))
    .orderBy(asc(nativeCaptureHistory.captureId), desc(nativeCaptureHistory.sequence)).limit(501);
  if (captures.length > 500 || captures.some((row) => row.document.state !== 'complete')) return true;
  const sources = await db.selectDistinct({ identity: sql<UsageExecutionIdentity>`${usageChanges.document}->'identity'`,
    sourceId: sql<string>`${usageChanges.document}->>'sourceId'`, turn: sql<string | null>`${usageChanges.document}->'scope'->>'turn'` })
    .from(usageChanges).where(and(eq(usageChanges.taskKey, taskKey), lte(usageChanges.sequence, through), sql`${usageChanges.document}->>'kind' = 'usage'`)).limit(501);
  const known = new Set(captures.map((row) => row.id));
  return sources.length > 500 || sources.some((row) => !row.turn || !known.has(nativeCaptureId(row.identity, row.sourceId, row.turn)));
}
