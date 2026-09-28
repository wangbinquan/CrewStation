import { and, asc, eq, gt, lte, inArray, sql } from 'drizzle-orm';
import { ExecutionValuationObservationSchema, RuntimeNativeCaptureSchema, type ExecutionObservationIdentity, type RunnerUsageCapture, type RuntimeFactPage } from '@crewstation/contracts';
import { conflict, validation, jsonHash } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import type { ExecutionValuationRequest, ExecutionValuationStore, UsageMeasurementRef, UsageLedgerStore, UsageLedgerTransaction, UsageTaskScope } from '../../ports/usageLedger';
import { costVisibility } from './tokenPriceTables';
import type { RuntimeStatisticsSnapshot } from '../../ports/usageLedger';
import { usageSnapshot, captureIncompleteAt } from './usageSnapshot';
import { nativeCaptureId, nativeRecordId, nativeStepKey, nativeMeasurementFingerprint, compareNativeBaseline, nativeCaptureSummary, type NativeCaptureDocument } from '../../domain/usageProjection';
import { nativeCaptures, nativeCaptureHistory, nativeSteps, nativeBaselines, executionValuations, executionValuationReceipts, usageChanges, usageEvents, usageEvidence, usageHeads, usagePages, usageProjections, usageSources } from './usageLedgerTables';

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
    capture: async (identity, frame) => { sequence = await persistNativeFrame(db, taskKey, sourceId, identity, frame, sequence); },
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
      return { items: items.map((row) => row.document), captureIncomplete: await captureIncompleteAt(db, taskKey, head), nextCursor: hasMore ? items.at(-1)!.sequence : head, persistedThrough: head, hasMore };
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
  if (!facts.items.length) return { tasks: [], observations: [], costVisible: {}, nativeCaptures: [], partial: facts.partial };
  const keys = facts.items.map((task) => taskKeyOf({ projectId: task.projectId as UsageTaskScope['projectId'], taskId: task.id as UsageTaskScope['taskId'] }));
  const usage = await db.select({ document: usageProjections.document }).from(usageProjections).where(inArray(usageProjections.taskKey, keys)).orderBy(asc(usageProjections.meterKey)).limit(20001);
  const remaining = Math.max(0, 20000 - usage.length);
  const valued = await db.select({ document: executionValuations.document }).from(executionValuations).where(inArray(executionValuations.taskKey, keys)).orderBy(asc(executionValuations.meterKey)).limit(remaining + 1);
  const captures = await db.select({ summary: nativeCaptures.summary }).from(nativeCaptures).where(inArray(nativeCaptures.taskKey, keys)).orderBy(asc(nativeCaptures.id)).limit(2001);
  const projects = [...new Set(facts.items.map((task) => task.projectId))];
  const policies = await db.select().from(costVisibility).where(inArray(costVisibility.projectId, projects));
  return { tasks: facts.items, observations: [...usage.slice(0, 20000).map((r) => r.document), ...valued.slice(0, remaining).map((r) => r.document)],
    costVisible: Object.fromEntries(policies.map((r) => [r.projectId, r.document.visibility === 'project-members-and-services'])),
    nativeCaptures: captures.slice(0, 2000).map((row) => row.summary),
    partial: facts.partial || usage.length > 20000 || valued.length > remaining || captures.length > 2000 };
}


async function captureRow(db: Executor, id: string) { return (await db.select().from(nativeCaptures).where(eq(nativeCaptures.id, id)).limit(1))[0]; }
async function persistProof(db: Executor, taskKey: string, sourceId: string, identity: ExecutionObservationIdentity, proof: NonNullable<RunnerUsageCapture['nativeProof']>) {
  const id = nativeCaptureId(identity, sourceId, proof.turn), previous = await captureRow(db, id), before = previous?.document;
  if (before && (before.proof.lineageKey !== proof.lineageKey || before.proof.turnIndex !== proof.turnIndex || jsonHash(before.proof.baseline) !== jsonHash(proof.baseline))) throw conflict('原生证明身份或基线冲突');
  if (before && before.proof.state !== 'pending' && jsonHash(before.proof) !== jsonHash(proof)) throw conflict('原生最终证明内容冲突');
  const document: NativeCaptureDocument = { id, identity, sourceId, proof,
    began: before?.began ?? (proof.state === 'pending' || proof.state === 'unsupported'), baselineRoot: before?.baselineRoot ?? proof.root,
    historicalRevisionGap: before?.historicalRevisionGap ?? false };
  const summary = previous?.summary ?? nativeCaptureSummary(document, { steps: 0, baselines: 0, unresolved: 0, revised: 0 });
  const finalized = document.began && (proof.state === 'complete' || proof.state === 'partial') && proof.fingerprint !== null && !proof.issues.includes('native-root-changed');
  const row = { id, taskKey, sourceId, turn: proof.turn, lineageKey: proof.lineageKey, root: proof.root, finalized, document, summary };
  await db.insert(nativeCaptures).values(row).onConflictDoUpdate({ target: nativeCaptures.id, set: { document, root: proof.root, finalized } });
  return id;
}
async function persistNativeMeasurements(db: Executor, taskKey: string, sourceId: string, identity: ExecutionObservationIdentity, frame: RunnerUsageCapture, affected: Set<string>, nativeKeys: Set<string>) {
  for (const measurement of frame.measurements) {
    if (!measurement.scope || measurement.scope.level !== 'request' || measurement.reporting !== 'delta' || measurement.inclusion !== 'self') continue;
    const id = nativeCaptureId(identity, sourceId, measurement.scope.turn), capture = await captureRow(db, id);
    if (!capture || capture.document.proof.state === 'unsupported') continue;
    if (capture.document.proof.turnIndex !== measurement.scope.turnIndex) throw conflict('原生用量轮次不匹配');
    const nativeKey = nativeStepKey(capture.lineageKey, measurement.scope.root, measurement.recordId);
    const prior = (await db.select().from(nativeSteps).where(and(eq(nativeSteps.captureId, id), eq(nativeSteps.recordId, measurement.recordId))).limit(1))[0];
    if (prior && prior.revision >= measurement.revision) continue;
    const row = { captureId: id, recordId: measurement.recordId, taskKey, nativeKey, root: measurement.scope.root,
      revision: measurement.revision, fingerprint: nativeMeasurementFingerprint(measurement) };
    await db.insert(nativeSteps).values(row).onConflictDoUpdate({ target: [nativeSteps.captureId, nativeSteps.recordId], set: row });
    affected.add(id); nativeKeys.add(nativeKey);
  }
}
async function persistNativeBaseline(db: Executor, taskKey: string, sourceId: string, identity: ExecutionObservationIdentity, baseline: NonNullable<RunnerUsageCapture['nativeBaseline']>, affected: Set<string>, nativeKeys: Set<string>) {
  const id = nativeCaptureId(identity, sourceId, baseline.turn), capture = await captureRow(db, id);
  if (!capture || capture.lineageKey !== baseline.lineageKey || capture.document.proof.baseline.kind !== 'resume' || capture.document.baselineRoot !== baseline.root || baseline.offset + baseline.steps.length > 10000) throw conflict('原生恢复基线没有对应的已接收证明');
  for (const [index, document] of baseline.steps.entries()) {
    const ordinal = baseline.offset + index, nativeKey = nativeStepKey(baseline.lineageKey, baseline.root, nativeRecordId(document.before));
    const prior = (await db.select().from(nativeBaselines).where(and(eq(nativeBaselines.captureId, id), eq(nativeBaselines.ordinal, ordinal))).limit(1))[0];
    if (prior && (jsonHash(prior.document) !== jsonHash(document) || prior.nativeKey !== nativeKey)) throw conflict('原生恢复历史重放内容冲突');
    const sameStep = (await db.select({ ordinal: nativeBaselines.ordinal }).from(nativeBaselines).where(and(eq(nativeBaselines.captureId, id), eq(nativeBaselines.nativeKey, nativeKey))).limit(1))[0];
    if (sameStep && sameStep.ordinal !== ordinal) throw conflict('同一恢复步骤不能占据多个基线位置');
    if (!prior) await db.insert(nativeBaselines).values({ captureId: id, ordinal, taskKey, nativeKey, document, status: 'unresolved', ownerId: null });
    nativeKeys.add(nativeKey);
  }
  affected.add(id);
}
/** Revisit retained baselines when an original owner arrives, without inventing numerical corrections. */
async function reconcileNativeKey(db: Executor, taskKey: string, nativeKey: string, affected: Set<string>) {
  const owners = await db.select({ id: nativeSteps.captureId, fingerprint: nativeSteps.fingerprint }).from(nativeSteps)
    .innerJoin(nativeCaptures, eq(nativeCaptures.id, nativeSteps.captureId))
    .where(and(eq(nativeSteps.taskKey, taskKey), eq(nativeSteps.nativeKey, nativeKey), eq(nativeCaptures.finalized, true), eq(nativeSteps.root, nativeCaptures.root))).limit(3);
  for (let offset = 0;; offset += 100) {
    const rows = await db.select().from(nativeBaselines).where(and(eq(nativeBaselines.taskKey, taskKey), eq(nativeBaselines.nativeKey, nativeKey)))
      .orderBy(asc(nativeBaselines.captureId), asc(nativeBaselines.ordinal)).limit(100).offset(offset);
    for (const row of rows) {
      const result = compareNativeBaseline(row.document, owners.filter((owner) => owner.id !== row.captureId));
      if (result.status !== row.status || result.owner !== row.ownerId) {
        await db.update(nativeBaselines).set({ status: result.status, ownerId: result.owner }).where(and(eq(nativeBaselines.captureId, row.captureId), eq(nativeBaselines.ordinal, row.ordinal)));
        affected.add(row.captureId);
      }
      if (result.status === 'revised' && result.owner) {
        const owner = await captureRow(db, result.owner);
        if (owner && !owner.document.historicalRevisionGap) {
          await db.update(nativeCaptures).set({ document: { ...owner.document, historicalRevisionGap: true } }).where(eq(nativeCaptures.id, result.owner));
          affected.add(result.owner);
        }
      }
    }
    if (rows.length < 100) break;
  }
}
async function projectNativeCapture(db: Executor, taskKey: string, id: string, sequence: number): Promise<number> {
  const current = await captureRow(db, id); if (!current) return sequence;
  const [stepCount] = await db.select({ count: sql<string>`count(*)`, mismatched: sql<string>`count(*) filter (where ${nativeSteps.root} <> ${current.root})` }).from(nativeSteps).where(eq(nativeSteps.captureId, id));
  const [baselineCount] = await db.select({ count: sql<string>`count(*)`, maximum: sql<number | null>`max(${nativeBaselines.ordinal})`,
    unresolved: sql<string>`count(*) filter (where ${nativeBaselines.status} = 'unresolved')`, revised: sql<string>`count(*) filter (where ${nativeBaselines.status} = 'revised')` })
    .from(nativeBaselines).where(eq(nativeBaselines.captureId, id));
  const counts = { steps: Number(stepCount!.count), baselines: Number(baselineCount!.count), unresolved: Number(baselineCount!.unresolved), revised: Number(baselineCount!.revised) };
  const document = nativeCaptureSummary(current.document, counts);
  if (Number(stepCount!.mismatched)) { document.state = 'partial'; document.issues.push('native-root-changed'); }
  if (baselineCount!.maximum !== null && Number(baselineCount!.maximum) + 1 !== counts.baselines) { document.state = 'partial'; document.issues.push('native-evidence-incomplete'); }
  const summary = RuntimeNativeCaptureSchema.parse(document);
  const history = await db.select({ sequence: nativeCaptureHistory.sequence }).from(nativeCaptureHistory).where(and(eq(nativeCaptureHistory.taskKey, taskKey), eq(nativeCaptureHistory.captureId, id))).limit(1);
  if (history.length && jsonHash(summary) === jsonHash(current.summary)) return sequence;
  if (sequence >= Number.MAX_SAFE_INTEGER) throw new RangeError('Native capture sequence exhausted');
  await db.update(nativeCaptures).set({ summary }).where(eq(nativeCaptures.id, id));
  await db.insert(nativeCaptureHistory).values({ taskKey, sequence: ++sequence, captureId: id, document: summary });
  return sequence;
}
async function persistNativeFrame(db: Executor, taskKey: string, sourceId: string, identity: ExecutionObservationIdentity, frame: RunnerUsageCapture, sequence: number): Promise<number> {
  const affected = new Set<string>(), nativeKeys = new Set<string>();
  if (frame.nativeProof) {
    const id = await persistProof(db, taskKey, sourceId, identity, frame.nativeProof); affected.add(id);
    if (frame.nativeProof.state !== 'pending') {
      const rows = await db.selectDistinct({ key: nativeSteps.nativeKey }).from(nativeSteps)
        .innerJoin(nativeBaselines, and(eq(nativeSteps.taskKey, nativeBaselines.taskKey), eq(nativeSteps.nativeKey, nativeBaselines.nativeKey)))
        .where(eq(nativeSteps.captureId, id));
      for (const row of rows) nativeKeys.add(row.key);
    }
  }
  await persistNativeMeasurements(db, taskKey, sourceId, identity, frame, affected, nativeKeys);
  if (frame.nativeBaseline) await persistNativeBaseline(db, taskKey, sourceId, identity, frame.nativeBaseline, affected, nativeKeys);
  for (const nativeKey of nativeKeys) await reconcileNativeKey(db, taskKey, nativeKey, affected);
  for (const id of affected) sequence = await projectNativeCapture(db, taskKey, id, sequence);
  return sequence;
}
