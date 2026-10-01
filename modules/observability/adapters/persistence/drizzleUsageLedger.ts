import { UsageRecordSchema } from '@crewstation/contracts';
import { runtimeLedgerScope, validateRuntimeFacts } from '../../domain/runtimeIdentity';
import { and, asc, eq, gt, lte, inArray, or, sql, type SQL } from 'drizzle-orm';
import { UsageValuationSchema, UsageNativeCaptureSchema, type UsageExecutionIdentity, type RunnerUsageCapture, type RuntimeFactPage, type RuntimeTaskFact } from '@crewstation/contracts';
import { conflict, validation, jsonHash } from '@crewstation/kernel';
import type { DevelopmentRunnerUsageCapture, DevelopmentNativeSource } from '@crewstation/contracts';
import type { DevelopmentUsageLedgerStore, DevelopmentUsageTransaction } from '../../ports/developmentUsage';
import { developmentCaptureSourceId, developmentNativePrefix, developmentNativeState, developmentNativeRootUsable, type DevelopmentNativeContext } from '../../domain/developmentNative';
import { persistDevelopmentModel, readDevelopmentModel } from './developmentUsageModels';
import type { Database, Executor } from '@crewstation/persistence';
import type { ExecutionValuationRequest, ExecutionValuationStore, UsageMeasurementRef, UsageLedgerStore, UsageTaskScope } from '../../ports/usageLedger';
import { costVisibility } from './tokenPriceTables';
import type { RuntimeStatisticsSnapshot } from '../../ports/usageLedger';
import { usageChangesWithCaptures, usageSnapshotWithCaptures, usageSnapshot, captureIncompleteAt } from './usageSnapshot';
import { nativeCaptureId, nativeRecordId, nativeStepKey, nativeMeasurementFingerprint, compareNativeBaseline, nativeCaptureSummary, nativeRepairCandidate, nativeStepFingerprint, reconcileNativeRepairModel, projectNativeRepair, rebuildUsageProjection, type UsageEvidence, type NativeCaptureDocument } from '../../domain/usageProjection';
import { nativeCaptures, nativeCaptureHistory, nativeSteps, nativeBaselines, nativeRepairs, executionValuations, executionValuationReceipts, usageChanges, usageEvents, usageEvidence, usageHeads, usagePages, usageProjections, usageSources } from './usageLedgerTables';

const taskKeyOf = (scope: UsageTaskScope) => jsonHash({ projectId: scope.projectId, taskId: scope.taskId });
const meterKeyOf = (value: UsageMeasurementRef) => jsonHash({ identity: value.identity, sourceId: value.sourceId, recordId: value.recordId });
const sourceWhere = (taskKey: string, sourceId: string) => and(eq(usageSources.taskKey, taskKey), eq(usageSources.sourceId, sourceId));
async function sourceCursor(db: Executor, taskKey: string, sourceId: string) {
  return (await db.select().from(usageSources).where(sourceWhere(taskKey, sourceId)).limit(1))[0]?.cursor ?? null;
}
function transaction(db: Executor, taskKey: string, sourceId: string, head: number): DevelopmentUsageTransaction {
  let sequence = head;
  const repairKeys = new Set<string>();
  return {
    developmentModel: (value) => persistDevelopmentModel(db, value),
    developmentCapture: async (context, frame) => { sequence = await persistDevelopmentFrame(db, taskKey, context, frame, sequence); },
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
      const meterKey = meterKeyOf(value), previous = await currentUsage(db, meterKey), retained = await currentRepair(db, meterKey);
      if (retained) repairKeys.add(retained.nativeKey);
      const repair = await applicableRepair(db, meterKey, value);
      const document = projectNativeRepair(value, previous, repair);
      if (document !== previous) sequence = await writeUsageProjection(db, taskKey, document, sequence);
    },
    capture: async (identity, frame) => { sequence = await persistNativeFrame(db, taskKey, sourceId, identity, frame, sequence); },
    advance: async (cursor, fingerprint) => {
      // A late raw revision can invalidate an old capture's scope even when its
      // new turn has no native frame. Revisit after every raw event is retained.
      const affected = new Set<string>(), meters = new Set<string>();
      for (const key of repairKeys) await reconcileNativeKey(db, taskKey, key, affected, meters);
      for (const key of meters) sequence = await reprojectNativeMeter(db, taskKey, key, sequence);
      for (const id of affected) sequence = await projectNativeCapture(db, taskKey, id, sequence);
      await db.insert(usagePages).values({ taskKey, sourceId, cursor, fingerprint });
      await db.update(usageSources).set({ cursor }).where(sourceWhere(taskKey, sourceId));
      await db.update(usageHeads).set({ sequence }).where(eq(usageHeads.taskKey, taskKey));
    },
  };
}

async function currentUsage(db: Executor, key: string) { return (await db.select().from(usageProjections).where(eq(usageProjections.meterKey, key)).limit(1))[0]?.document; }
async function currentRepair(db: Executor, key: string) { return (await db.select().from(nativeRepairs).where(eq(nativeRepairs.meterKey, key)).limit(1))[0]; }
async function applicableRepair(db: Executor, key: string, value: NonNullable<Awaited<ReturnType<typeof currentUsage>>>) {
  const repair = await currentRepair(db, key);
  if (!repair?.active) return;
  const document = reconcileNativeRepairModel(value, repair.document);
  if (!document) await db.update(nativeRepairs).set({ active: false }).where(eq(nativeRepairs.meterKey, key));
  else if (document !== repair.document) await db.update(nativeRepairs).set({ document }).where(eq(nativeRepairs.meterKey, key));
  return document;
}
async function writeUsageProjection(db: Executor, taskKey: string, value: NonNullable<Awaited<ReturnType<typeof currentUsage>>>, sequence: number) {
  if (sequence >= Number.MAX_SAFE_INTEGER) throw new RangeError('Usage synchronization sequence exhausted');
  const meterKey = meterKeyOf(value);
  await db.insert(usageProjections).values({ meterKey, taskKey, document: value }).onConflictDoUpdate({ target: usageProjections.meterKey, set: { document: value } });
  await db.insert(usageChanges).values({ taskKey, meterKey, sequence: ++sequence, document: value });
  return sequence;
}
async function reprojectNativeMeter(db: Executor, taskKey: string, key: string, sequence: number) {
  const previous = await currentUsage(db, key);
  if (!previous) return sequence;
  const evidence: UsageEvidence[] = [];
  for (let after = 0;;) {
    const rows = await db.select().from(usageEvidence).where(and(eq(usageEvidence.meterKey, key), gt(usageEvidence.revision, after))).orderBy(asc(usageEvidence.revision)).limit(200);
    evidence.push(...rows.map((r) => r.document));
    if (rows.length < 200) break;
    after = rows.at(-1)!.revision;
  }
  const base = rebuildUsageProjection(evidence), repair = await applicableRepair(db, key, base);
  const document = projectNativeRepair(base, previous, repair);
  return document === previous ? sequence : writeUsageProjection(db, taskKey, document, sequence);
}

function ledgerChange<T>(db: Database, scope: UsageTaskScope, sourceId: string, work: (tx: DevelopmentUsageTransaction) => Promise<T>) {
  return db.transaction(async (tx) => {
    const taskKey = taskKeyOf(scope);
    await tx.insert(usageHeads).values({ taskKey, projectId: scope.projectId, taskId: scope.taskId, sequence: 0 }).onConflictDoNothing();
    const [head] = await tx.select().from(usageHeads).where(eq(usageHeads.taskKey, taskKey)).for('update');
    await tx.insert(usageSources).values({ taskKey, sourceId, cursor: null }).onConflictDoNothing();
    return work(transaction(tx, taskKey, sourceId, head!.sequence));
  });
}
export function drizzleUsageLedger(db: Database): UsageLedgerStore & DevelopmentUsageLedgerStore {
  return {
    changesWithCaptures: (scope, after, limit) => usageChangesWithCaptures(db, taskKeyOf(scope), after, limit),
    snapshotWithCaptures: (scope, query, now, visibilityRevision) => usageSnapshotWithCaptures(db, taskKeyOf(scope), query, now, visibilityRevision),
    snapshot: (scope, query, now, visibilityRevision) => usageSnapshot(db, taskKeyOf(scope), query, now, visibilityRevision),
    cursor: (scope, sourceId) => sourceCursor(db, taskKeyOf(scope), sourceId),
    // Both participants serialize on the same task head and commit one watermark.
    change: (scope, sourceId, work) => ledgerChange(db, scope, sourceId, work),
    changeDevelopment: (scope, sourceId, work) => ledgerChange(db, scope, sourceId, work),
    developmentModel: (ref, revision) => readDevelopmentModel(db, ref, revision),
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
  const document = UsageValuationSchema.parse({ ...draft, valuationRevision: revision, revision });
  await db.insert(executionValuations).values({ meterKey, taskKey, basisFingerprint, document }).onConflictDoUpdate({ target: executionValuations.meterKey, set: { basisFingerprint, document } });
  await db.insert(usageChanges).values({ taskKey, meterKey, sequence: sequence + 1, document });
  await db.update(usageHeads).set({ sequence: sequence + 1 }).where(eq(usageHeads.taskKey, taskKey));
  return document;
}

export function drizzleExecutionValuations(db: Database): ExecutionValuationStore {
  return {
    usage: async (ref) => (await db.select().from(usageProjections).where(eq(usageProjections.meterKey, meterKeyOf(ref))).limit(1))[0]?.document,
    receipt: (scope, requestKey) => valuationReceipt(db, taskKeyOf(scope), requestKey),
    pendingNativeRepairs: async (scope, limit) => {
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new RangeError('Invalid native valuation page');
      return db.select({ usage: usageProjections.document, modelEvidence: nativeSteps.modelEvidence }).from(nativeRepairs)
        .innerJoin(usageProjections, eq(nativeRepairs.meterKey, usageProjections.meterKey))
        .leftJoin(executionValuations, eq(nativeRepairs.valuationKey, executionValuations.meterKey))
        .leftJoin(nativeSteps, and(sql`${nativeRepairs.document}->>'ownerId' = ${nativeSteps.captureId}`, sql`${usageProjections.document}->>'recordId' = ${nativeSteps.recordId}`))
        .where(and(eq(nativeRepairs.taskKey, taskKeyOf(scope)), sql`${executionValuations.document}->>'usageRevision' IS DISTINCT FROM ${usageProjections.document}->'projection'->>'projectionRevision'`))
        .orderBy(asc(nativeRepairs.meterKey)).limit(limit);
    },
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
  validateRuntimeFacts(facts.items);
  if (!facts.items.length) return { tasks: [], observations: [], costVisible: {}, nativeCaptures: [], partial: facts.partial, sourceScope: facts.sourceScope };
  const keys = [...new Set(facts.items.map((task) => taskKeyOf(runtimeLedgerScope(task) as UsageTaskScope)))];
  const usage = await db.select({ document: usageProjections.document }).from(usageProjections).where(and(inArray(usageProjections.taskKey, keys), selectedStatisticsIdentity(sql`${usageProjections.document}->'identity'`, facts.items))).orderBy(asc(usageProjections.meterKey)).limit(20001);
  const remaining = Math.max(0, 20000 - usage.length);
  const valued = await db.select({ document: executionValuations.document }).from(executionValuations).where(and(inArray(executionValuations.taskKey, keys), selectedStatisticsIdentity(sql`${executionValuations.document}->'identity'`, facts.items))).orderBy(asc(executionValuations.meterKey)).limit(remaining + 1);
  const captures = await db.select({ summary: nativeCaptures.summary }).from(nativeCaptures).where(and(inArray(nativeCaptures.taskKey, keys), selectedStatisticsIdentity(sql`${nativeCaptures.summary}->'identity'`, facts.items))).orderBy(asc(nativeCaptures.id)).limit(2001);
  const projects = [...new Set(facts.items.map((task) => task.projectId))];
  const policies = await db.select().from(costVisibility).where(inArray(costVisibility.projectId, projects));
  return { tasks: facts.items, observations: [...usage.slice(0, 20000).map((r) => UsageRecordSchema.parse(r.document)), ...valued.slice(0, remaining).map((r) => UsageValuationSchema.parse(r.document))],
    costVisible: Object.fromEntries(policies.map((r) => [r.projectId, r.document.visibility === 'project-members-and-services'])),
    nativeCaptures: captures.slice(0, 2000).map((row) => UsageNativeCaptureSchema.parse(row.summary)),
    sourceScope: facts.sourceScope, partial: facts.partial || usage.length > 20000 || valued.length > remaining || captures.length > 2000 };
}


function selectedStatisticsIdentity(identity: SQL, tasks: RuntimeTaskFact[]) {
  return or(...tasks.map((task) => {
    const scope = runtimeLedgerScope(task), common = sql`${identity}->>'projectId' = ${scope.projectId} AND ${identity}->>'taskId' = ${scope.taskId}`;
    return task.source?.kind === 'development-agent'
      ? and(common, sql`${identity}->>'sourceKind' = 'development-agent' AND ${identity}->>'executionId' = ${task.id} AND ${identity}->>'executionGeneration' = '1'`)
      : and(common, sql`${identity}->>'sourceKind' IS NULL`);
  }));
}

async function captureRow(db: Executor, id: string) { return (await db.select().from(nativeCaptures).where(eq(nativeCaptures.id, id)).limit(1))[0]; }
interface DevelopmentFrameContext { context: DevelopmentNativeContext; source?: DevelopmentNativeSource }
async function rekeyDevelopmentCapture(db: Executor, id: string, before: NativeCaptureDocument | undefined, after: NativeCaptureDocument, keys: Set<string>) {
  if (!before?.development || !after.development) return;
  const previous = developmentNativePrefix(id, before.development), current = developmentNativePrefix(id, after.development);
  if (previous === current) return;
  // Two guarded updates, each bounded to the capture's 10,000-row ownership index.
  const steps = await db.update(nativeSteps).set({ nativeKey: sql`${current} || substring(${nativeSteps.nativeKey} from ${previous.length + 1}::integer)` })
    .where(and(eq(nativeSteps.captureId, id), sql`left(${nativeSteps.nativeKey}, ${previous.length}) = ${previous}`)).returning({ key: nativeSteps.nativeKey });
  const baselines = await db.update(nativeBaselines).set({ nativeKey: sql`${current} || substring(${nativeBaselines.nativeKey} from ${previous.length + 1}::integer)` })
    .where(and(eq(nativeBaselines.captureId, id), sql`left(${nativeBaselines.nativeKey}, ${previous.length}) = ${previous}`)).returning({ key: nativeBaselines.nativeKey });
  for (const row of [...steps, ...baselines]) { keys.add(row.key); keys.add(previous + row.key.slice(current.length)); }
}
async function persistProof(db: Executor, taskKey: string, sourceId: string, identity: UsageExecutionIdentity,
  proof: NonNullable<RunnerUsageCapture['nativeProof']>, keys: Set<string>, development?: DevelopmentFrameContext) {
  const id = nativeCaptureId(identity, sourceId, proof.turn), previous = await captureRow(db, id), before = previous?.document;
  if (before && (before.proof.lineageKey !== proof.lineageKey || before.proof.turnIndex !== proof.turnIndex || jsonHash(before.proof.baseline) !== jsonHash(proof.baseline))) throw conflict('原生证明身份或基线冲突');
  if (before && !!before.development !== !!development) throw conflict('原生来源不能跨接开发与旧业务证明');
  const lateBegin = development?.source?.stage === 'begin' && before?.proof.state !== 'pending';
  const finishFirst = development?.source?.stage === 'finish' && !before?.development?.finish;
  if (before && before.proof.state !== 'pending' && !lateBegin && !finishFirst && jsonHash(before.proof) !== jsonHash(proof)) throw conflict('原生最终证明内容冲突');
  const selectedProof = before && lateBegin ? before.proof : proof;
  const state = development ? developmentNativeState(before?.development, development.context, proof, development.source) : undefined;
  const document: NativeCaptureDocument = { id, identity, sourceId, proof: selectedProof,
    began: state ? state.begin !== null : before?.began ?? (proof.state === 'pending' || proof.state === 'unsupported'),
    baselineRoot: before?.baselineRoot ?? proof.root, historicalRevisionGap: before?.historicalRevisionGap ?? false,
    ...(state ? { development: state } : {}) };
  const summary = previous?.summary ?? nativeCaptureSummary(document, { steps: 0, baselines: 0, unresolved: 0, revised: 0 });
  const finalProof = document.proof;
  const finalized = document.began && (finalProof.state === 'complete' || finalProof.state === 'partial') && finalProof.fingerprint !== null &&
    !finalProof.issues.includes('native-root-changed') && (!state || state.sourceVerified && developmentNativeRootUsable(state) && !state.overflow);
  const row = { id, taskKey, sourceId, turn: finalProof.turn, lineageKey: finalProof.lineageKey, root: finalProof.root, finalized, document, summary };
  await db.insert(nativeCaptures).values(row).onConflictDoUpdate({ target: nativeCaptures.id, set: { document, root: finalProof.root, finalized } });
  await rekeyDevelopmentCapture(db, id, before, document, keys);
  return id;
}
function captureStepKey(capture: typeof nativeCaptures.$inferSelect, root: string, recordId: string) {
  const key = nativeStepKey(capture.lineageKey, root, recordId);
  return capture.document.development ? developmentNativePrefix(capture.id, capture.document.development) + key : key;
}
async function retainDevelopmentOverflow(db: Executor, capture: typeof nativeCaptures.$inferSelect, keys: Set<string>) {
  const state = capture.document.development;
  if (!state || state.overflow) return;
  const document = { ...capture.document, development: { ...state, overflow: true } };
  await db.update(nativeCaptures).set({ document, finalized: false }).where(eq(nativeCaptures.id, capture.id));
  for (const row of await db.selectDistinct({ key: nativeSteps.nativeKey }).from(nativeSteps)
    .innerJoin(nativeBaselines, and(eq(nativeSteps.taskKey, nativeBaselines.taskKey), eq(nativeSteps.nativeKey, nativeBaselines.nativeKey)))
    .where(eq(nativeSteps.captureId, capture.id))) keys.add(row.key);
}
async function persistNativeMeasurements(db: Executor, taskKey: string, sourceId: string, identity: UsageExecutionIdentity, frame: RunnerUsageCapture, affected: Set<string>, nativeKeys: Set<string>) {
  for (const measurement of frame.measurements) {
    if (!measurement.scope || measurement.scope.level !== 'request' || measurement.reporting !== 'delta' || measurement.inclusion !== 'self') continue;
    const id = nativeCaptureId(identity, sourceId, measurement.scope.turn), capture = await captureRow(db, id);
    if (!capture || capture.document.proof.state === 'unsupported') continue;
    if (capture.document.proof.turnIndex !== measurement.scope.turnIndex) throw conflict('原生用量轮次不匹配');
    const nativeKey = captureStepKey(capture, measurement.scope.root, measurement.recordId);
    const prior = (await db.select().from(nativeSteps).where(and(eq(nativeSteps.captureId, id), eq(nativeSteps.recordId, measurement.recordId))).limit(1))[0];
    if (!prior && capture.document.development?.selection) {
      const [count] = await db.select({ value: sql<string>`count(*)` }).from(nativeSteps).where(eq(nativeSteps.captureId, id));
      if (Number(count!.value) >= 10000) { await retainDevelopmentOverflow(db, capture, nativeKeys); affected.add(id); continue; }
    }
    const projected = await currentUsage(db, meterKeyOf({ identity, sourceId, recordId: measurement.recordId }));
    const modelEvidence = projected?.projection.modelRevision === measurement.revision && measurement.actualModel && jsonHash(measurement.actualModel) === projected.modelRef
      ? measurement : prior?.modelEvidence ?? null;
    if (prior && prior.revision >= measurement.revision && jsonHash(prior.modelEvidence) === jsonHash(modelEvidence)) continue;
    const row = prior && prior.revision > measurement.revision ? { ...prior, modelEvidence } : {
      captureId: id, recordId: measurement.recordId, taskKey, nativeKey, root: measurement.scope.root, modelEvidence,
      revision: measurement.revision, fingerprint: nativeMeasurementFingerprint(measurement) };
    await db.insert(nativeSteps).values(row).onConflictDoUpdate({ target: [nativeSteps.captureId, nativeSteps.recordId], set: row });
    affected.add(id); nativeKeys.add(nativeKey);
  }
}
async function persistNativeBaseline(db: Executor, taskKey: string, sourceId: string, identity: UsageExecutionIdentity, baseline: NonNullable<RunnerUsageCapture['nativeBaseline']>, affected: Set<string>, nativeKeys: Set<string>) {
  const id = nativeCaptureId(identity, sourceId, baseline.turn), capture = await captureRow(db, id);
  if (!capture || capture.lineageKey !== baseline.lineageKey || capture.document.proof.baseline.kind !== 'resume' || capture.document.baselineRoot !== baseline.root || baseline.offset + baseline.steps.length > 10000) throw conflict('原生恢复基线没有对应的已接收证明');
  for (const [index, document] of baseline.steps.entries()) {
    const ordinal = baseline.offset + index, nativeKey = captureStepKey(capture, baseline.root, nativeRecordId(document.before));
    const prior = (await db.select().from(nativeBaselines).where(and(eq(nativeBaselines.captureId, id), eq(nativeBaselines.ordinal, ordinal))).limit(1))[0];
    if (prior && (jsonHash(prior.document) !== jsonHash(document) || prior.nativeKey !== nativeKey)) throw conflict('原生恢复历史重放内容冲突');
    const sameStep = (await db.select({ ordinal: nativeBaselines.ordinal }).from(nativeBaselines).where(and(eq(nativeBaselines.captureId, id), eq(nativeBaselines.nativeKey, nativeKey))).limit(1))[0];
    if (sameStep && sameStep.ordinal !== ordinal) throw conflict('同一恢复步骤不能占据多个基线位置');
    if (!prior) await db.insert(nativeBaselines).values({ captureId: id, ordinal, taskKey, nativeKey, document, status: 'unresolved', ownerId: null });
    nativeKeys.add(nativeKey);
  }
  affected.add(id);
}
type NativeOwner = { id: string; fingerprint: string; recordId: string; document: NativeCaptureDocument };
async function resolveNativeBaseline(db: Executor, taskKey: string, row: typeof nativeBaselines.$inferSelect, owners: NativeOwner[], meters: Set<string>) {
  const candidates = owners.filter((owner) => owner.id !== row.captureId), result = compareNativeBaseline(row.document, candidates);
  if (owners.length !== 1 || candidates.length !== 1) return result;
  const owner = candidates[0]!, ref = { identity: owner.document.identity, sourceId: owner.document.sourceId, recordId: owner.recordId };
  const key = meterKeyOf(ref), usage = await currentUsage(db, key), source = await captureRow(db, row.captureId);
  const prior = await currentRepair(db, key);
  const candidate = usage && source ? nativeRepairCandidate(owner.document, source.document, row.document, usage, prior?.active ? prior.document : undefined) : undefined;
  if (!candidate || !usage) return result;
  const document = { ...candidate, ordinal: row.ordinal };
  if (prior && (prior.document.order.epoch !== document.order.epoch ||
      prior.document.order.sequence === document.order.sequence && nativeStepFingerprint(prior.document.step) !== nativeStepFingerprint(document.step)))
    return { status: 'revised', owner: owner.id };
  if (!prior || document.order.sequence > prior.document.order.sequence || !prior.active) {
    const retained = prior && prior.document.order.sequence > document.order.sequence ? prior.document : document;
    const next = reconcileNativeRepairModel(usage, retained);
    if (!next) return { status: 'revised', owner: owner.id };
    await db.insert(nativeRepairs).values({ meterKey: key, valuationKey: jsonHash({ kind: 'valuation', usageKey: key }), taskKey, nativeKey: row.nativeKey, active: true, document: next })
      .onConflictDoUpdate({ target: nativeRepairs.meterKey, set: { active: true, document: next } });
    meters.add(key);
  }
  return { status: result.status === 'same' ? 'same' : 'corrected', owner: owner.id };
}
/** Revisit every retained baseline, including late owners and selected model evidence. */
async function reconcileNativeKey(db: Executor, taskKey: string, nativeKey: string, affected: Set<string>, meters: Set<string>) {
  const owners = await db.select({ id: nativeSteps.captureId, fingerprint: nativeSteps.fingerprint, recordId: nativeSteps.recordId, document: nativeCaptures.document }).from(nativeSteps)
    .innerJoin(nativeCaptures, eq(nativeCaptures.id, nativeSteps.captureId))
    .where(and(eq(nativeSteps.taskKey, taskKey), eq(nativeSteps.nativeKey, nativeKey), eq(nativeCaptures.finalized, true), eq(nativeSteps.root, nativeCaptures.root))).limit(3);
  if (owners.length !== 1) {
    const obsolete = await db.select().from(nativeRepairs).where(and(eq(nativeRepairs.taskKey, taskKey), eq(nativeRepairs.nativeKey, nativeKey), eq(nativeRepairs.active, true)));
    for (const row of obsolete) {
      await db.update(nativeRepairs).set({ active: false }).where(eq(nativeRepairs.meterKey, row.meterKey)); meters.add(row.meterKey); affected.add(row.document.ownerId);
    }
  }
  for (const owner of owners) affected.add(owner.id);
  for (let offset = 0;; offset += 100) {
    const rows = await db.select().from(nativeBaselines).where(and(eq(nativeBaselines.taskKey, taskKey), eq(nativeBaselines.nativeKey, nativeKey)))
      .orderBy(asc(nativeBaselines.captureId), asc(nativeBaselines.ordinal)).limit(100).offset(offset);
    for (const row of rows) {
      const result = await resolveNativeBaseline(db, taskKey, row, owners, meters);
      if (result.status !== row.status || result.owner !== row.ownerId) {
        await db.update(nativeBaselines).set({ status: result.status, ownerId: result.owner }).where(and(eq(nativeBaselines.captureId, row.captureId), eq(nativeBaselines.ordinal, row.ordinal)));
        affected.add(row.captureId); if (row.ownerId) affected.add(row.ownerId);
      }
    }
    if (rows.length < 100) break;
  }
}
async function projectNativeCapture(db: Executor, taskKey: string, id: string, sequence: number): Promise<number> {
  const current = await captureRow(db, id); if (!current) return sequence;
  const [stepCount] = await db.select({ count: sql<string>`count(*)`, mismatched: sql<string>`count(*) filter (where ${nativeSteps.root} <> ${current.root})` }).from(nativeSteps).where(eq(nativeSteps.captureId, id));
  const [baselineCount] = await db.select({ count: sql<string>`count(*)`, maximum: sql<number | null>`max(${nativeBaselines.ordinal})`,
    unresolved: sql<string>`count(*) filter (where ${nativeBaselines.status} = 'unresolved')`, revised: sql<string>`count(*) filter (where ${nativeBaselines.status} = 'revised')`, corrected: sql<string>`count(*) filter (where ${nativeBaselines.status} = 'corrected')` })
    .from(nativeBaselines).where(eq(nativeBaselines.captureId, id));
  const counts = { steps: Number(stepCount!.count), baselines: Number(baselineCount!.count), unresolved: Number(baselineCount!.unresolved), revised: Number(baselineCount!.revised), corrected: Number(baselineCount!.corrected) };
  const gaps = await db.select({ id: nativeBaselines.captureId }).from(nativeSteps)
    .innerJoin(nativeBaselines, and(eq(nativeSteps.taskKey, nativeBaselines.taskKey), eq(nativeSteps.nativeKey, nativeBaselines.nativeKey)))
    .where(and(eq(nativeSteps.captureId, id), sql`${nativeBaselines.captureId} <> ${id}`, inArray(nativeBaselines.status, ['unresolved', 'revised']))).limit(1);
  const capture = { ...current.document, historicalRevisionGap: gaps.length > 0 };
  const document = nativeCaptureSummary(capture, counts);
  if (Number(stepCount!.mismatched)) { document.state = 'partial'; document.issues.push('native-root-changed'); }
  if (baselineCount!.maximum !== null && Number(baselineCount!.maximum) + 1 !== counts.baselines) { document.state = 'partial'; document.issues.push('native-evidence-incomplete'); }
  const summary = UsageNativeCaptureSchema.parse(document);
  const history = await db.select({ sequence: nativeCaptureHistory.sequence }).from(nativeCaptureHistory).where(and(eq(nativeCaptureHistory.taskKey, taskKey), eq(nativeCaptureHistory.captureId, id))).limit(1);
  if (history.length && jsonHash(summary) === jsonHash(current.summary)) return sequence;
  if (sequence >= Number.MAX_SAFE_INTEGER) throw new RangeError('Native capture sequence exhausted');
  await db.update(nativeCaptures).set({ summary, document: capture }).where(eq(nativeCaptures.id, id));
  await db.insert(nativeCaptureHistory).values({ taskKey, sequence: ++sequence, captureId: id, document: summary });
  return sequence;
}
async function persistNativeFrame(db: Executor, taskKey: string, sourceId: string, identity: UsageExecutionIdentity, frame: RunnerUsageCapture, sequence: number, development?: DevelopmentFrameContext): Promise<number> {
  const affected = new Set<string>(), nativeKeys = new Set<string>(), meters = new Set<string>();
  if (frame.nativeProof) {
    const id = await persistProof(db, taskKey, sourceId, identity, frame.nativeProof, nativeKeys, development); affected.add(id);
    if (frame.nativeProof.state !== 'pending') {
      const rows = await db.selectDistinct({ key: nativeSteps.nativeKey }).from(nativeSteps)
        .innerJoin(nativeBaselines, and(eq(nativeSteps.taskKey, nativeBaselines.taskKey), eq(nativeSteps.nativeKey, nativeBaselines.nativeKey)))
        .where(eq(nativeSteps.captureId, id));
      for (const row of rows) nativeKeys.add(row.key);
      const baselines = await db.select({ key: nativeBaselines.nativeKey }).from(nativeBaselines).where(eq(nativeBaselines.captureId, id));
      for (const row of baselines) nativeKeys.add(row.key);
    }
  }
  await persistNativeMeasurements(db, taskKey, sourceId, identity, frame, affected, nativeKeys);
  if (frame.nativeBaseline) await persistNativeBaseline(db, taskKey, sourceId, identity, frame.nativeBaseline, affected, nativeKeys);
  for (const nativeKey of nativeKeys) await reconcileNativeKey(db, taskKey, nativeKey, affected, meters);
  for (const key of meters) sequence = await reprojectNativeMeter(db, taskKey, key, sequence);
  for (const id of affected) sequence = await projectNativeCapture(db, taskKey, id, sequence);
  return sequence;
}

/** A stream page may contain several turns; baseline-only frames resolve their retained turn exactly. */
async function persistDevelopmentFrame(db: Executor, taskKey: string, context: DevelopmentNativeContext, frame: DevelopmentRunnerUsageCapture, sequence: number) {
  const identity = context.registration.identity;
  const sourceId = (turn: string, index: number) => developmentCaptureSourceId(context.streamSourceId, turn, index);
  if (frame.nativeProof) {
    const proof = frame.nativeProof;
    sequence = await persistNativeFrame(db, taskKey, sourceId(proof.turn, proof.turnIndex), identity,
      { version: frame.version, diagnostics: frame.diagnostics, measurements: [], nativeProof: proof }, sequence,
      { context, ...(frame.nativeSource ? { source: frame.nativeSource } : {}) });
  }
  const groups = new Map<string, RunnerUsageCapture['measurements']>();
  for (const measurement of frame.measurements) {
    if (!measurement.scope) continue;
    const id = sourceId(measurement.scope.turn, measurement.scope.turnIndex);
    const rows = groups.get(id) ?? []; rows.push(measurement); groups.set(id, rows);
  }
  for (const [id, measurements] of groups) sequence = await persistNativeFrame(db, taskKey, id, identity,
    { version: frame.version, diagnostics: frame.diagnostics, measurements }, sequence);
  if (frame.nativeBaseline) {
    const rows = await db.select().from(nativeCaptures).where(and(eq(nativeCaptures.taskKey, taskKey), eq(nativeCaptures.turn, frame.nativeBaseline.turn),
      sql`${nativeCaptures.document}->'development'->>'streamSourceId' = ${context.streamSourceId}`)).limit(2);
    if (rows.length !== 1) throw conflict('开发恢复基线尚无唯一原轮次证明');
    sequence = await persistNativeFrame(db, taskKey, rows[0]!.sourceId, identity,
      { version: frame.version, diagnostics: frame.diagnostics, measurements: [], nativeBaseline: frame.nativeBaseline }, sequence);
  }
  return sequence;
}
