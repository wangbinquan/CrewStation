import type { UsageRecord, UsageExecutionIdentity, NativeUsageProof, NativeUsageOrder, NativeUsageStep, NativeUsageBaseline, RunnerUsageMeasurement, UsageNativeCapture, RuntimeUsageMetrics, UsageObservation } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';
import { developmentNativeRootChanged, developmentNativeRootUsable, type DevelopmentNativeState } from './developmentNative';
import { subtractTokenBaseline, TOKEN_BUCKETS, type TokenUsage } from './tokenUsage';

export type UsageEvidence = Omit<UsageRecord, 'projection'>;
type Projection = UsageRecord['projection'];
type Issue = Projection['issues'][number];
interface Fold {
  reported: UsageEvidence;
  usable: UsageEvidence;
  projection: Omit<Projection, 'projectionRevision'>;
}
const unknown: TokenUsage = { input: null, cacheRead: null, cacheWrite: null, output: null };
const emptyWatermarks = { input: null, cacheRead: null, cacheWrite: null, output: null };

function identity(value: UsageEvidence) {
  return jsonHash({ identity: value.identity, sourceId: value.sourceId, recordId: value.recordId,
    reporting: value.reporting, inclusion: value.inclusion, scope: value.scope, basis: value.basis });
}
function modelRevision(next: UsageEvidence, before?: Fold): number | undefined {
  if (next.modelRef === null) return before?.projection.modelRevision;
  return before?.usable.modelRef === next.modelRef
    ? before.projection.modelRevision ?? before.usable.revision : next.revision;
}
function diagnostic(next: UsageEvidence, before: Fold | undefined, issue: Issue): Fold {
  // A rejected numeric decrease may still prove the previously unknown model.
  const refine = issue === 'unexplained-decrease' && before?.usable.modelRef === null && next.modelRef !== null;
  const reported = before?.reported ?? next, usable = before?.usable ?? { ...next, usage: unknown };
  const evidenceRevision = refine ? next.revision : before?.projection.modelRevision;
  return { reported: refine ? { ...reported, modelRef: next.modelRef } : reported,
    usable: refine ? { ...usable, modelRef: next.modelRef } : usable, projection: {
    observedRevision: next.revision, ...(evidenceRevision === undefined ? {} : { modelRevision: evidenceRevision }),
    contribution: before?.projection.contribution ?? { ...unknown },
    coveredThrough: before?.projection.coveredThrough ?? (next.scope ? { ...emptyWatermarks } : null),
    complete: false, issues: [...new Set([...(before?.projection.issues ?? []), issue])],
  } };
}
function knownUsage(next: UsageEvidence, before?: Fold): TokenUsage {
  return { input: next.usage.input ?? before?.usable.usage.input ?? null,
    cacheRead: next.usage.cacheRead ?? before?.usable.usage.cacheRead ?? null,
    cacheWrite: next.usage.cacheWrite ?? before?.usable.usage.cacheWrite ?? null,
    output: next.usage.output ?? before?.usable.usage.output ?? null };
}
function watermarks(next: UsageEvidence, contribution: TokenUsage, before?: Fold): Projection['coveredThrough'] {
  if (!next.scope) return null;
  const through = (bucket: typeof TOKEN_BUCKETS[number]) => contribution[bucket] === null ? null
    : next.usage[bucket] === null ? before?.projection.coveredThrough?.[bucket] ?? null
      : next.coveredThroughTurn ?? next.scope!.turnIndex;
  return { input: through('input'), cacheRead: through('cacheRead'), cacheWrite: through('cacheWrite'), output: through('output') };
}
function fold(next: UsageEvidence, before?: Fold): Fold {
  if (before && (identity(next) !== identity(before.usable) ||
      (before.usable.modelRef !== null && next.modelRef !== before.usable.modelRef))) return diagnostic(next, before, 'identity-conflict');
  if (next.validity === 'invalid-final') return diagnostic(next, before, 'invalid-final');
  if (before && next.validity !== 'correction' && TOKEN_BUCKETS.some((bucket) => {
    const old = before.usable.usage[bucket], value = next.usage[bucket];
    return old !== null && value !== null && BigInt(value) < BigInt(old);
  })) return diagnostic(next, before, 'unexplained-decrease');
  const usage = knownUsage(next, before), issues: Issue[] = [];
  let contribution = usage;
  if (next.basis.kind === 'native-session') {
    if (next.basis.baseline === null) { contribution = unknown; issues.push('baseline-unknown'); }
    else {
      try { contribution = subtractTokenBaseline(usage, next.basis.baseline); }
      catch { return diagnostic(next, before, 'baseline-exceeds-observation'); }
    }
  }
  if (next.inclusion === 'unknown') issues.push('unknown-inclusion');
  const evidenceRevision = modelRevision(next, before);
  return { reported: next, usable: { ...next, usage }, projection: {
    observedRevision: next.revision, ...(evidenceRevision === undefined ? {} : { modelRevision: evidenceRevision }),
    contribution: { ...contribution }, coveredThrough: watermarks(next, contribution, before),
    complete: next.coverage === 'complete' && issues.length === 0 && TOKEN_BUCKETS.every((bucket) => next.usage[bucket] !== null && contribution[bucket] !== null), issues,
  } };
}

/** Rebuild one meter from retained native evidence, in native revision order.
 * A late older sample may change the projection without changing observedRevision. */
export function rebuildUsageProjection(evidence: readonly UsageEvidence[], previous?: UsageRecord): UsageRecord {
  if (evidence.length === 0) throw new RangeError('Cannot rebuild usage without retained evidence');
  const byRevision = new Map<number, UsageEvidence>();
  for (const sample of evidence) {
    const prior = byRevision.get(sample.revision);
    if (prior && jsonHash(prior) !== jsonHash(sample)) throw new RangeError('Conflicting native usage revision');
    byRevision.set(sample.revision, sample);
  }
  let state: Fold | undefined;
  for (const sample of [...byRevision.values()].sort((a, b) => a.revision - b.revision)) state = fold(sample, state);
  const result = state!;
  const projectionRevision = previous?.projection.projectionRevision ?? 0;
  const candidate = { ...result.reported, projection: { ...result.projection, projectionRevision } };
  if (previous && jsonHash(previous) === jsonHash(candidate)) return previous;
  if (projectionRevision === Number.MAX_SAFE_INTEGER) throw new RangeError('Usage projection revision exhausted');
  return { ...candidate, projection: { ...candidate.projection, projectionRevision: projectionRevision + 1 } };
}


export interface NativeCaptureDocument {
  id: string; identity: UsageExecutionIdentity; sourceId: string; proof: NativeUsageProof;
  began: boolean; baselineRoot: string | null; historicalRevisionGap: boolean;
  development?: DevelopmentNativeState;
}
export type NativeBaselineEntry = NativeUsageBaseline['steps'][number];
export interface NativeRepair {
  ownerId: string; captureId: string; ordinal: number; order: NativeUsageOrder; step: NativeUsageStep; modelRef: string | null; scope: NonNullable<UsageRecord['scope']>;
}
/** A correction is attached to the original request and never borrows a native revision. */
export function nativeRepairCandidate(owner: NativeCaptureDocument, source: NativeCaptureDocument, row: NativeBaselineEntry, usage: UsageRecord, accepted?: NativeRepair): Omit<NativeRepair, 'ordinal'> | undefined {
  if ([owner.development, source.development].some((state) => state && (!state.sourceVerified || !developmentNativeRootUsable(state)))) return;
  const before = row.before, after = row.after, order = source.proof.order, origin = owner.proof.order, baseline = source.proof.baseline.order;
  if (!row.afterObserved || !after || !order || !origin || !baseline || !source.proof.fingerprint || !source.began ||
      source.proof.state === 'pending' || source.proof.state === 'unsupported' || source.proof.baseline.kind !== 'resume' ||
      order.epoch !== origin.epoch || order.epoch !== baseline.epoch || order.sequence <= origin.sequence || order.sequence <= baseline.sequence ||
      owner.identity.projectId !== source.identity.projectId || owner.identity.taskId !== source.identity.taskId ||
      owner.proof.lineageKey !== source.proof.lineageKey || owner.proof.root !== source.proof.root ||
      usage.basis.kind !== 'invocation' || usage.reporting !== 'delta' || usage.inclusion !== 'self' || usage.scope?.level !== 'request') return;
  const scope = usage.scope;
  if (scope.turn !== owner.proof.turn || scope.turnIndex !== owner.proof.turnIndex) return;
  for (const step of [before, after]) {
    if (nativeRecordId(step) !== usage.recordId || scope.root !== owner.proof.root || scope.session !== step.sessionId ||
        scope.parentSession !== step.parentSessionId || jsonHash(scope.ancestors) !== jsonHash(step.ancestors)) return;
  }
  const retained = accepted?.ownerId === owner.id && accepted.order.epoch === order.epoch &&
    (accepted.order.sequence > order.sequence || accepted.order.sequence === order.sequence && nativeStepFingerprint(accepted.step) === nativeStepFingerprint(after));
  // Late model metadata cannot revoke already accepted numeric evidence. This
  // exception only reuses the same/later retained order, never a new correction.
  if (TOKEN_BUCKETS.some((bucket) => after.usage[bucket] === null) ||
      (after.actualModel === null ? null : jsonHash(after.actualModel)) !== usage.modelRef && !(after.actualModel === null && retained)) return;
  return { ownerId: owner.id, captureId: source.id, order, step: after, modelRef: usage.modelRef, scope };
}
/** A repair retains its request scope and permits only one-way model refinement. */
export function reconcileNativeRepairModel(value: UsageRecord, repair: NativeRepair): NativeRepair | undefined {
  if (value.basis.kind !== 'invocation' || value.reporting !== 'delta' || value.inclusion !== 'self' ||
      jsonHash(value.scope) !== jsonHash(repair.scope) || repair.modelRef !== null && repair.modelRef !== value.modelRef) return;
  return repair.modelRef === value.modelRef ? repair : { ...repair, modelRef: value.modelRef };
}
/** Compare only the final projection, after an independently proved historical overlay. */
export function projectNativeRepair(value: UsageRecord, previous: UsageRecord | undefined, repair?: NativeRepair): UsageRecord {
  const revision = previous?.projection.projectionRevision ?? 0;
  let projection = { ...value.projection, projectionRevision: revision };
  if (repair) {
    const issues = projection.issues.filter((issue) => issue !== 'unexplained-decrease');
    const turn = value.scope!.turnIndex;
    projection = { ...projection, contribution: { ...repair.step.usage }, complete: issues.length === 0, issues,
      coveredThrough: { input: turn, output: turn, cacheRead: turn, cacheWrite: turn } };
  }
  const candidate = { ...value, projection };
  if (previous && jsonHash(candidate) === jsonHash(previous)) return previous;
  if (revision === Number.MAX_SAFE_INTEGER) throw new RangeError('Usage projection revision exhausted');
  return { ...candidate, projection: { ...projection, projectionRevision: revision + 1 } };
}

export const nativeRecordId = (step: NativeUsageStep) => `opencode:step:${jsonHash({ session: step.sessionId, id: step.id })}`;
export const nativeCaptureId = (identity: UsageExecutionIdentity, sourceId: string, turn: string) => jsonHash({ identity, sourceId, turn });
export const nativeStepKey = (lineageKey: string, root: string, recordId: string) => jsonHash({ lineageKey, root, recordId });
export function nativeStepFingerprint(step: NativeUsageStep): string {
  return jsonHash({ session: step.sessionId, parent: step.parentSessionId, ancestors: step.ancestors, usage: step.usage, model: step.actualModel });
}
export function nativeMeasurementFingerprint(row: RunnerUsageMeasurement): string {
  return jsonHash({ session: row.scope?.session, parent: row.scope?.parentSession, ancestors: row.scope?.ancestors, usage: row.usage, model: row.actualModel });
}
export function compareNativeBaseline(row: NativeBaselineEntry, owners: readonly { id: string; fingerprint: string }[]): { status: 'same' | 'revised' | 'unresolved'; owner: string | null } {
  if (owners.length !== 1) return { status: 'unresolved', owner: null };
  const owner = owners[0]!;
  const revised = owner.fingerprint !== nativeStepFingerprint(row.before) ||
    row.afterObserved && (row.after === null || owner.fingerprint !== nativeStepFingerprint(row.after));
  return { status: revised ? 'revised' : 'same', owner: owner.id };
}
export function nativeCaptureSummary(value: NativeCaptureDocument, counts: { steps: number; baselines: number; unresolved: number; revised: number; corrected?: number }): UsageNativeCapture {
  const issues = new Set(value.proof.issues);
  if (value.development && (!value.development.sourceVerified || value.development.overflow || !developmentNativeRootUsable(value.development))) issues.add('native-evidence-incomplete');
  if (value.development && developmentNativeRootChanged(value.development)) issues.add('native-root-changed');
  if (!value.began && value.proof.state !== 'unsupported') issues.add('native-baseline-not-started');
  if ((value.proof.state === 'complete' || value.proof.state === 'partial' && value.proof.issues.length === 1 && value.proof.issues[0] === 'native-prior-revision-gap') && (counts.steps !== value.proof.emitted || counts.baselines !== value.proof.baselineSteps)) issues.add('native-evidence-incomplete');
  if (counts.unresolved) issues.add('native-owner-unresolved');
  if (counts.revised || value.historicalRevisionGap) issues.add('native-prior-revision-gap');
  if (!counts.revised && !counts.unresolved && !value.historicalRevisionGap && counts.baselines === value.proof.baselineSteps) issues.delete('native-prior-revision-gap');
  const repaired = value.proof.state === 'partial' && value.proof.issues.length === 1 && value.proof.issues[0] === 'native-prior-revision-gap' && issues.size === 0;
  const state = repaired ? 'complete' : value.proof.state === 'complete' && issues.size ? 'partial' : value.proof.state;
  return { id: value.id, identity: value.identity, sourceId: value.sourceId, proof: value.proof, state, issues: [...issues],
    receivedSteps: counts.steps, receivedBaselineSteps: counts.baselines, unresolvedBaselineSteps: counts.unresolved,
    revisedBaselineSteps: counts.revised, correctedBaselineSteps: counts.corrected ?? 0, historicalRevisionGap: value.historicalRevisionGap };
}

/** Native traversal quality qualifies the known subtotal without changing its value. */
export function qualifyNativeMetrics(metrics: RuntimeUsageMetrics, captures: readonly UsageNativeCapture[], observations: readonly UsageObservation[]): RuntimeUsageMetrics {
  const missing = observations.some((row) => row.kind === 'usage' && !captures.some((capture) => capture.sourceId === row.sourceId && capture.proof.turn === row.scope?.turn && capture.proof.turnIndex === row.scope.turnIndex && capture.proof.root === row.scope.root));
  const complete = !missing && captures.length > 0 && captures.every((capture) => capture.state === 'complete');
  if (complete && metrics.records === 0 && captures.every((capture) => capture.receivedSteps === 0 && capture.proof.emitted === 0 && capture.proof.steps === capture.proof.baselineSteps)) {
    const reasons = metrics.reasons.filter((reason) => reason !== 'usage-missing');
    return { ...metrics, observedExecutions: 1, reasons,
      tokens: { ...metrics.tokens, hasKnown: true, hasKnownBuckets: { input: true, cacheRead: true, cacheWrite: true, output: true }, complete: !metrics.partial, unknownBuckets: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
      cost: { ...metrics.cost, amount: metrics.cost.visible ? '0' : null, complete: metrics.cost.visible && !metrics.partial } };
  }
  if (complete) return metrics;
  const reasons = new Set(metrics.reasons);
  if (!captures.length || missing) reasons.add('native-capture-unobserved');
  for (const capture of captures) {
    if (capture.state !== 'complete') reasons.add('native-capture-' + capture.state);
    if (capture.historicalRevisionGap || capture.revisedBaselineSteps) reasons.add('native-prior-revision-gap');
    if (capture.unresolvedBaselineSteps) reasons.add('native-owner-unresolved');
  }
  return { ...metrics, reasons: [...reasons], tokens: { ...metrics.tokens, complete: false }, cost: { ...metrics.cost, complete: false } };
}
