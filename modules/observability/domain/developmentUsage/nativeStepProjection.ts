import type { RunnerUsageMeasurement, UsageRecord } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';
import type { UsageEvidence } from '../usageProjection';
import { developmentCaptureSourceId } from '../developmentNative';
import type { QualifiedNativePath as CompleteNativePath } from './nativeStepOwner';
import type { NativeBaselineQualification } from './nativeBaselineQualification';
import type { NativeOriginalStep } from './nativeOriginalPage';
import { nativeOwnerReceiptMatches, nativeSourceSequenceKey, pagedNativeRecordId, type NativeStepOwnerReceipt } from './nativeStepOwner';

type ActualModel = RunnerUsageMeasurement['actualModel'];
export interface NativeStepProjectionInput {
  readonly original: NativeOriginalStep; readonly path: CompleteNativePath;
  readonly baseline: NativeBaselineQualification; readonly beforeStep?: NativeOriginalStep['step'];
  readonly originalOwner?: UsageRecord; readonly ownerReceipt?: NativeStepOwnerReceipt;
  readonly ownerResolution: 'missing' | 'unique' | 'ambiguous';
  readonly originalModel?: ActualModel; readonly observedAt: string;
}
export type NativeStepProjection =
  | { readonly state: 'held'; readonly issues: readonly string[] }
  | { readonly state: 'unchanged'; readonly owner: UsageRecord; readonly outdated?: true }
  | { readonly state: 'write'; readonly evidence: UsageEvidence; readonly actualModel: ActualModel };
const modelOf = (step: NativeOriginalStep['step']): ActualModel => step.model === null ? null :
  { provider: step.model.provider, model: step.model.id, condition: null };
function newEvidence(input: NativeStepProjectionInput, model: ActualModel): UsageEvidence {
  const { source, step } = input.original, { path } = input, turnIndex = source.pass.preparation.turnIndex;
  return { kind: 'usage', identity: source.pass.registration.identity,
    sourceId: developmentCaptureSourceId(source.pass.streamSourceId, source.page.identity.turn, turnIndex),
    recordId: pagedNativeRecordId(step), revision: 1, adapterVersion: 'opencode-native-page-v2',
    occurredAt: step.occurredAt === null ? null : new Date(step.occurredAt).toISOString(), observedAt: input.observedAt,
    modelRef: model === null ? null : jsonHash(model), reporting: 'delta', inclusion: 'self',
    coverage: 'complete', validity: 'valid', coveredThroughTurn: null, usage: { ...step.usage }, basis: { kind: 'invocation' },
    scope: { root: path.root, session: path.session, parentSession: path.parentSession,
      turn: source.page.identity.turn, turnIndex, level: 'request', native: { passKey: source.passKey,
        identity: source.page.identity, ownerReceiptId: source.original.admission.ownerReceiptId,
        pageOrdinal: source.page.ordinal, cumulativeDigest: source.page.cumulativeDigest,
        sourceNamespace: path.sourceNamespace, pathDigest: path.pathDigest, depth: path.depth } } };
}
/** Historical numeric/model corrections retain the original execution, scope, price owner and occurredAt. */
export function projectNativeStep(input: NativeStepProjectionInput): NativeStepProjection {
  const { source, step, fingerprint } = input.original;
  const { path, baseline, originalOwner: owner, ownerReceipt: receipt, beforeStep } = input;
  if (source.page.identity.phase !== 'final' || path.root !== source.page.identity.rootSessionId ||
      step.id !== path.session || step.parentSessionId !== path.parentSession ||
      jsonHash(step) !== fingerprint || jsonHash(source.page.steps[input.original.index]) !== fingerprint)
    return { state: 'held', issues: ['native-original-step-path-unmatched'] };
  if (input.ownerResolution === 'ambiguous') return { state: 'held', issues: ['native-owner-ambiguous'] };
  if (owner && (input.ownerResolution !== 'unique' || !receipt || !nativeOwnerReceiptMatches(owner, receipt, input.original, path)))
    return { state: 'held', issues: ['native-original-owner-scope-unmatched'] };
  if (!owner && (receipt || input.ownerResolution !== 'missing'))
    return { state: 'held', issues: ['native-original-owner-missing'] };
  if (receipt && receipt.sourceSequenceKey !== nativeSourceSequenceKey(input.original))
    return { state: 'held', issues: ['native-owner-order-unmatched'] };
  if (owner && receipt!.referenceState === 'projected' && receipt!.lastPassKey === source.passKey) {
    if (receipt!.lastWatermark !== source.original.ack.sourceWatermark || receipt!.lastStepFingerprint !== fingerprint)
      return { state: 'held', issues: ['native-current-pass-owner-conflict'] };
    return { state: 'unchanged', owner };
  }
  if (baseline.state === 'unknown') return { state: 'held', issues: baseline.issues };
  if (baseline.sourceNamespace !== path.sourceNamespace)
    return { state: 'held', issues: ['native-original-step-path-unmatched'] };
  if (owner && BigInt(receipt!.lastWatermark) >= BigInt(source.original.ack.sourceWatermark))
    return { state: 'unchanged', owner, outdated: true };
  const model = modelOf(step);
  if (beforeStep === undefined) {
    if (owner) return { state: 'held', issues: ['native-before-step-owner-unmatched'] };
    return { state: 'write', evidence: newEvidence(input, model), actualModel: model };
  }
  if (baseline.state !== 'complete-before' || beforeStep.stepId !== step.stepId || beforeStep.id !== step.id ||
      beforeStep.parentSessionId !== step.parentSessionId || !owner || !receipt ||
      BigInt(receipt.lastWatermark) > BigInt(baseline.beforeWatermark))
    return { state: 'held', issues: ['native-owner-unresolved'] };
  const selectedModel = model ?? input.originalModel ?? null, ref = selectedModel === null ? null : jsonHash(selectedModel);
  if (owner.modelRef !== null && ref !== owner.modelRef)
    return { state: 'held', issues: ['native-historical-model-conflict'] };
  if (receipt.referenceState === 'projected' && jsonHash(owner.projection.contribution) === jsonHash(step.usage) &&
      owner.modelRef === ref && owner.coverage === 'complete') return { state: 'unchanged', owner };
  if (owner.projection.observedRevision === Number.MAX_SAFE_INTEGER) throw new RangeError('Original native usage revision exhausted');
  const { projection: _, ...original } = owner;
  return { state: 'write', actualModel: selectedModel, evidence: { ...original,
    revision: owner.projection.observedRevision + 1, observedAt: input.observedAt, usage: { ...step.usage }, modelRef: ref,
    coverage: 'complete', validity: 'correction' } };
}
