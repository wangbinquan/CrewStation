import { and, asc, eq, gt, lte, inArray } from 'drizzle-orm';
import { ExecutionValuationObservationSchema, type RuntimeFactPage } from '@crewstation/contracts';
import { conflict, validation, jsonHash } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import type { ExecutionValuationRequest, ExecutionValuationStore, UsageMeasurementRef, UsageLedgerStore, UsageLedgerTransaction, UsageTaskScope } from '../../ports/usageLedger';
import { costVisibility } from './tokenPriceTables';
import type { RuntimeStatisticsSnapshot } from '../../ports/usageLedger';
import { usageSnapshot } from './usageSnapshot';
import { executionValuations, executionValuationReceipts, usageChanges, usageEvents, usageEvidence, usageHeads, usagePages, usageProjections, usageSources } from './usageLedgerTables';

const taskKeyOf = (scope: UsageTaskScope) => jsonHash({ projectId: scope.projectId, taskId: scope.taskId });
const meterKeyOf = (value: UsageMeasurementRef) => jsonHash({ identity: value.identity, sourceId: value.sourceId, recordId: value.recordId });
const sourceWhere = (taskKey: string, sourceId: string) => and(eq(usageSources.taskKey, taskKey), eq(usageSources.sourceId, sourceId));
async function sourceCursor(db: Executor, taskKey: string, sourceId: string) {
  return (await db.select().from(usageSources).where(sourceWhere(taskKey, sourceId)).limit(1))[0]?.cursor ?? null;
}
function transaction(db: Executor, taskKey: string, sourceId: string, head: number): UsageLedgerTransaction {
  let sequence = head;
  return {
    cursor: () => sourceCursor(db, taskKey, sourceId),
    pageFingerprint: async (cursor) => (await db.select().from(usagePages).where(and(eq(usagePages.taskKey, taskKey), eq(usagePages.sourceId, sourceId), eq(usagePages.cursor, cursor))).limit(1))[0]?.fingerprint,
    eventFingerprint: async (eventId) => (await db.select().from(usageEvents).where(and(eq(usageEvents.taskKey, taskKey), eq(usageEvents.sourceId, sourceId), eq(usageEvents.eventId, eventId))).limit(1))[0]?.fingerprint,
    revisionFingerprint: async (value) => (await db.select().from(usageEvidence).where(and(eq(usageEvidence.meterKey, meterKeyOf(value)), eq(usageEvidence.revision, value.revision))).limit(1))[0]?.fingerprint,
    evidence: async (value, after, limit) => (await db.select().from(usageEvidence).where(and(eq(usageEvidence.meterKey, meterKeyOf(value)), gt(usageEvidence.revision, after))).orderBy(asc(usageEvidence.revision)).limit(limit)).map((row) => row.document),
    current: async (value) => (await db.select().from(usageProjections).where(eq(usageProjections.meterKey, meterKeyOf(value))).limit(1))[0]?.document,
    append: async (event, fingerprint) => {
      await db.insert(usageEvidence).values({ meterKey: meterKeyOf(event.measurement), revision: event.measurement.revision, fingerprint, document: event.measurement }).onConflictDoNothing();
      await db.insert(usageEvents).values({ taskKey, sourceId, eventId: event.eventId, fingerprint });
    },
    project: async (value) => {
      if (sequence >= Number.MAX_SAFE_INTEGER) throw new RangeError('Usage synchronization sequence exhausted');
      const meterKey = meterKeyOf(value);
      await db.insert(usageProjections).values({ meterKey, taskKey, document: value }).onConflictDoUpdate({ target: usageProjections.meterKey, set: { document: value } });
      await db.insert(usageChanges).values({ taskKey, meterKey, sequence: ++sequence, document: value });
    },
    advance: async (cursor, fingerprint) => {
      await db.insert(usagePages).values({ taskKey, sourceId, cursor, fingerprint });
      await db.update(usageSources).set({ cursor }).where(sourceWhere(taskKey, sourceId));
      await db.update(usageHeads).set({ sequence }).where(eq(usageHeads.taskKey, taskKey));
    },
  };
}

export function drizzleUsageLedger(db: Database): UsageLedgerStore {
  return {
    snapshot: (scope, query, now, visibilityRevision) => usageSnapshot(db, taskKeyOf(scope), query, now, visibilityRevision),
    cursor: (scope, sourceId) => sourceCursor(db, taskKeyOf(scope), sourceId),
    change: (scope, sourceId, work) => db.transaction(async (tx) => {
      const taskKey = taskKeyOf(scope);
      await tx.insert(usageHeads).values({ taskKey, projectId: scope.projectId, taskId: scope.taskId, sequence: 0 }).onConflictDoNothing();
      // A per-task lock makes sync sequence order equal commit order across sources.
      const [head] = await tx.select().from(usageHeads).where(eq(usageHeads.taskKey, taskKey)).for('update');
      await tx.insert(usageSources).values({ taskKey, sourceId, cursor: null }).onConflictDoNothing();
      return work(transaction(tx, taskKey, sourceId, head!.sequence));
    }),
    changes: async (scope, after, limit) => {
      if (!Number.isSafeInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1 || limit > 500) throw new RangeError('Invalid usage changes page');
      const taskKey = taskKeyOf(scope);
      const head = (await db.select().from(usageHeads).where(eq(usageHeads.taskKey, taskKey)).limit(1))[0]?.sequence ?? 0;
      if (after > head) throw validation('Usage cursor is ahead of committed evidence', { reason: 'cursor-ahead' });
      const rows = await db.select().from(usageChanges).where(and(eq(usageChanges.taskKey, taskKey), gt(usageChanges.sequence, after), lte(usageChanges.sequence, head))).orderBy(asc(usageChanges.sequence)).limit(limit + 1);
      const items = rows.slice(0, limit), hasMore = rows.length > limit;
      return { items: items.map((row) => row.document), nextCursor: hasMore ? items.at(-1)!.sequence : head, persistedThrough: head, hasMore };
    },
  };
}

const receiptWhere = (taskKey: string, requestKey: string) => and(eq(executionValuationReceipts.taskKey, taskKey), eq(executionValuationReceipts.requestKey, requestKey));
async function valuationReceipt(db: Executor, taskKey: string, requestKey: string) {
  return (await db.select().from(executionValuationReceipts).where(receiptWhere(taskKey, requestKey)).limit(1))[0];
}
async function persistValuation(db: Executor, input: ExecutionValuationRequest, taskKey: string, sequence: number, basisFingerprint: string, draft: Parameters<ExecutionValuationStore['commit']>[3]) {
  const usageKey = meterKeyOf(input.measurement), meterKey = jsonHash({ kind: 'valuation', usageKey });
  const current = (await db.select().from(usageProjections).where(eq(usageProjections.meterKey, usageKey)).limit(1))[0]?.document;
  if (current?.projection.projectionRevision !== input.usageRevision) throw conflict('用量投影已更新，请基于当前修订重新估值');
  const previous = (await db.select().from(executionValuations).where(eq(executionValuations.meterKey, meterKey)).limit(1))[0];
  if (previous?.basisFingerprint === basisFingerprint) return previous.document;
  const revision = (previous?.document.valuationRevision ?? 0) + 1;
  if (!Number.isSafeInteger(revision) || sequence >= Number.MAX_SAFE_INTEGER) throw new RangeError('Execution valuation sequence exhausted');
  const document = ExecutionValuationObservationSchema.parse({ ...draft, valuationRevision: revision, revision });
  await db.insert(executionValuations).values({ meterKey, taskKey, basisFingerprint, document }).onConflictDoUpdate({ target: executionValuations.meterKey, set: { basisFingerprint, document } });
  await db.insert(usageChanges).values({ taskKey, meterKey, sequence: sequence + 1, document });
  await db.update(usageHeads).set({ sequence: sequence + 1 }).where(eq(usageHeads.taskKey, taskKey));
  return document;
}

export function drizzleExecutionValuations(db: Database): ExecutionValuationStore {
  return {
    usage: async (ref) => (await db.select().from(usageProjections).where(eq(usageProjections.meterKey, meterKeyOf(ref))).limit(1))[0]?.document,
    receipt: (scope, requestKey) => valuationReceipt(db, taskKeyOf(scope), requestKey),
    commit: (input, fingerprint, basisFingerprint, draft) => db.transaction(async (tx) => {
      const taskKey = taskKeyOf(input.measurement.identity);
      const [head] = await tx.select().from(usageHeads).where(eq(usageHeads.taskKey, taskKey)).for('update');
      const prior = await valuationReceipt(tx, taskKey, input.requestKey);
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw conflict('估值请求标识对应不同证据');
        return prior.document;
      }
      if (!head) throw conflict('尚无已提交的用量投影');
      const document = await persistValuation(tx, input, taskKey, head.sequence, basisFingerprint, draft);
      await tx.insert(executionValuationReceipts).values({ taskKey, requestKey: input.requestKey, fingerprint, document });
      return document;
    }),
  };
}


/** Called inside the same repeatable-read transaction as the owner task facts. */
export async function readRuntimeStatisticsLedger(db: Executor, facts: RuntimeFactPage): Promise<RuntimeStatisticsSnapshot> {
  if (!facts.items.length) return { tasks: [], observations: [], costVisible: {}, partial: facts.partial };
  const keys = facts.items.map((task) => taskKeyOf({ projectId: task.projectId as UsageTaskScope['projectId'], taskId: task.id as UsageTaskScope['taskId'] }));
  const usage = await db.select({ document: usageProjections.document }).from(usageProjections).where(inArray(usageProjections.taskKey, keys)).orderBy(asc(usageProjections.meterKey)).limit(20001);
  const remaining = Math.max(0, 20000 - usage.length);
  const valued = await db.select({ document: executionValuations.document }).from(executionValuations).where(inArray(executionValuations.taskKey, keys)).orderBy(asc(executionValuations.meterKey)).limit(remaining + 1);
  const projects = [...new Set(facts.items.map((task) => task.projectId))];
  const policies = await db.select().from(costVisibility).where(inArray(costVisibility.projectId, projects));
  return { tasks: facts.items, observations: [...usage.slice(0, 20000).map((r) => r.document), ...valued.slice(0, remaining).map((r) => r.document)],
    costVisible: Object.fromEntries(policies.map((r) => [r.projectId, r.document.visibility === 'project-members-and-services'])),
    partial: facts.partial || usage.length > 20000 || valued.length > remaining };
}
