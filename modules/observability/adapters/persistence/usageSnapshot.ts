import { and, asc, desc, eq, gt, lte, sql } from 'drizzle-orm';
import { conflict, gone, newResourceId, notFound, validation } from '@crewstation/kernel';
import type { Executor } from '@crewstation/persistence';
import { ExecutionCaptureObservationSchema, ExecutionObservationV2Schema, type UsageNativeCapture, type UsageExecutionIdentity } from '@crewstation/contracts';
import { nativeCaptureId } from '../../domain/usageProjection';
import type { UsageSyncChanges, UsageSyncSnapshot, UsageSnapshot, UsageSnapshotQuery } from '../../ports/usageLedger';
import { nativeCaptureHistory, usageChanges, usageHeads, usageSnapshots } from "./tables";

const lifetimeMs = 30 * 60 * 1000;
async function snapshotRecord(db: Executor, taskKey: string, snapshotId: string | undefined, now: number, visibilityRevision: number, version: 1 | 2 = 1) {
  if (snapshotId !== undefined && snapshotId.startsWith('v2:') !== (version === 2)) throw validation('快照版本与请求版本不一致');
  if (snapshotId !== undefined) {
    const row = (await db.select().from(usageSnapshots).where(and(eq(usageSnapshots.id, snapshotId), eq(usageSnapshots.taskKey, taskKey))).limit(1))[0];
    if (!row) throw notFound('用量快照不存在');
    if (row.visibilityRevision !== visibilityRevision) throw conflict('金额可见性已变更，请重新读取快照');
    if (row.expiresAt <= now) throw gone('用量快照已过期，请重新读取');
    return row;
  }
  const through = (await db.select().from(usageHeads).where(eq(usageHeads.taskKey, taskKey)).limit(1))[0]?.sequence ?? 0;
  const row = { id: (version === 2 ? 'v2:' : '') + newResourceId(), taskKey, through, visibilityRevision, createdAt: now, expiresAt: now + lifetimeMs };
  await db.insert(usageSnapshots).values(row);
  return row;
}

/** Read each meter's last committed version at the persisted snapshot boundary.
 * Later corrections and newly-created meters cannot drift into subsequent pages. */
export async function usageSnapshot(db: Executor, taskKey: string, query: UsageSnapshotQuery, now: number, visibilityRevision: number): Promise<UsageSnapshot> {
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


function captureObservation(row: { sequence: number; document: UsageNativeCapture }) {
  const capture = row.document;
  return ExecutionCaptureObservationSchema.parse({ kind: 'capture', identity: capture.identity,
    sourceId: capture.sourceId, recordId: capture.id, revision: row.sequence,
    occurredAt: null, observedAt: capture.proof.observedAt, capture });
}

/** Both histories share the task sequence. Merge before limiting and only advance
 * to the last returned sequence, so a dense source cannot hide the other one. */
export async function usageChangesWithCaptures(db: Executor, taskKey: string, after: number, limit: number): Promise<UsageSyncChanges> {
  if (!Number.isSafeInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1 || limit > 500) throw new RangeError('Invalid usage changes page');
  const head = (await db.select().from(usageHeads).where(eq(usageHeads.taskKey, taskKey)).limit(1))[0]?.sequence ?? 0;
  if (after > head) throw validation('Usage cursor is ahead of committed evidence', { reason: 'cursor-ahead' });
  const values = await db.select({ sequence: usageChanges.sequence, document: usageChanges.document }).from(usageChanges)
    .where(and(eq(usageChanges.taskKey, taskKey), gt(usageChanges.sequence, after), lte(usageChanges.sequence, head))).orderBy(asc(usageChanges.sequence)).limit(limit + 1);
  const captures = await db.select({ sequence: nativeCaptureHistory.sequence, document: nativeCaptureHistory.document }).from(nativeCaptureHistory)
    .where(and(eq(nativeCaptureHistory.taskKey, taskKey), gt(nativeCaptureHistory.sequence, after), lte(nativeCaptureHistory.sequence, head))).orderBy(asc(nativeCaptureHistory.sequence)).limit(limit + 1);
  const rows = [...values.map((row) => ({ sequence: row.sequence, item: ExecutionObservationV2Schema.parse(row.document) })),
    ...captures.map((row) => ({ sequence: row.sequence, item: captureObservation(row) }))].sort((a, b) => a.sequence - b.sequence);
  const selected = rows.slice(0, limit), hasMore = rows.length > limit;
  return { items: selected.map((row) => row.item), captureIncomplete: await captureIncompleteAt(db, taskKey, head),
    nextCursor: hasMore ? selected.at(-1)!.sequence : head, persistedThrough: head, hasMore };
}

/** Versioned cursor and snapshot IDs keep old readers from consuming half a v2 snapshot. */
export async function usageSnapshotWithCaptures(db: Executor, taskKey: string, query: UsageSnapshotQuery, now: number, visibilityRevision: number): Promise<UsageSyncSnapshot> {
  if (!Number.isSafeInteger(visibilityRevision) || visibilityRevision < 0 || !Number.isSafeInteger(now) || now < 0 || now > Number.MAX_SAFE_INTEGER - lifetimeMs) throw new RangeError('Invalid usage snapshot clock or visibility');
  if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 500 ||
    (query.snapshotId === undefined) !== (query.cursor === undefined) ||
    (query.snapshotId !== undefined && (query.snapshotId.length === 0 || query.snapshotId.length > 512)) ||
    (query.cursor !== undefined && !/^v2:(capture|usage|valuation):[a-f0-9]{64}$/.test(query.cursor))) throw validation('Invalid v2 usage snapshot page');
  const snapshot = await snapshotRecord(db, taskKey, query.snapshotId, now, visibilityRevision, 2);
  const after = query.cursor?.slice(3);
  const valueKey = sql<string>`${usageChanges.document}->>'kind' || ':' || ${usageChanges.meterKey}`;
  const captureKey = sql<string>`'capture:' || ${nativeCaptureHistory.captureId}`;
  const values = await db.selectDistinctOn([valueKey], { key: valueKey, document: usageChanges.document }).from(usageChanges)
    .where(and(eq(usageChanges.taskKey, taskKey), lte(usageChanges.sequence, snapshot.through), after === undefined ? undefined : gt(valueKey, after)))
    .orderBy(asc(valueKey), desc(usageChanges.sequence)).limit(query.limit + 1);
  const captures = await db.selectDistinctOn([captureKey], { key: captureKey, sequence: nativeCaptureHistory.sequence, document: nativeCaptureHistory.document }).from(nativeCaptureHistory)
    .where(and(eq(nativeCaptureHistory.taskKey, taskKey), lte(nativeCaptureHistory.sequence, snapshot.through), after === undefined ? undefined : gt(captureKey, after)))
    .orderBy(asc(captureKey), desc(nativeCaptureHistory.sequence)).limit(query.limit + 1);
  const rows = [...values.map((row) => ({ key: row.key, item: ExecutionObservationV2Schema.parse(row.document) })),
    ...captures.map((row) => ({ key: row.key, item: captureObservation(row) }))].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  const selected = rows.slice(0, query.limit);
  return { snapshotId: snapshot.id, snapshotThrough: snapshot.through, visibilityRevision: snapshot.visibilityRevision,
    expiresAt: snapshot.expiresAt, createdAt: snapshot.createdAt, items: selected.map((row) => row.item),
    captureIncomplete: await captureIncompleteAt(db, taskKey, snapshot.through), nextCursor: rows.length > query.limit ? 'v2:' + selected.at(-1)!.key : null };
}
