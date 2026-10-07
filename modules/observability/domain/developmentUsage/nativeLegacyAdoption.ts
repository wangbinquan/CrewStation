import type { UsageRecord, UsageNativeCapture } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';
import { developmentNativeRootUsable } from '../developmentNative';
import type { DevelopmentModelEvidence } from '../developmentNative';
import type { NativeCaptureDocument } from '../usageProjection';
import type { NativeOriginalStep } from './nativeOriginalPage';
import { originalNativeOwnerScope, pagedNativeRecordId, nativeSourceSequenceKey, type NativeStepOwnerReceipt } from './nativeStepOwner';
import type { QualifiedNativePath as CompleteNativePath } from './nativeStepOwner';

export interface NativeLegacyOwner {
  readonly capture: NativeCaptureDocument; readonly summary: UsageNativeCapture;
  readonly usage: UsageRecord; readonly model: DevelopmentModelEvidence | undefined;
}
/** Adopt only an actual complete before whose original physical store, path, step and original projection all match. */
export function qualifyNativeLegacyAdoption(before: NativeOriginalStep, path: CompleteNativePath,
  candidates: readonly NativeLegacyOwner[]): NativeStepOwnerReceipt | undefined {
  if (candidates.length !== 1 || before.source.page.identity.phase !== 'baseline') return;
  const { capture, summary, usage, model } = candidates[0]!, state = capture.development, pass = before.source.pass;
  const actualModel = before.step.model === null ? null : { provider: before.step.model.provider, model: before.step.model.id, condition: null };
  if (!state?.sourceVerified || !developmentNativeRootUsable(state) || summary.state !== 'complete' ||
      summary.issues.length || !capture.began || !state.begin || !state.finish ||
      state.registration.podUid !== pass.registration.podUid || state.selection?.expectedNamespace !== pass.selection.expectedNamespace ||
      state.finish.scope !== 'execution-local' || state.finish.issues.length ||
      jsonHash(state.begin.beginStore) !== jsonHash(pass.preparation.store) ||
      jsonHash(state.finish.finalStore) !== jsonHash(pass.preparation.store) ||
      state.finishRoot !== path.root || capture.proof.root !== path.root ||
      capture.identity.projectId !== pass.registration.identity.projectId || capture.identity.taskId !== pass.registration.identity.taskId ||
      usage.recordId !== pagedNativeRecordId(before.step) || jsonHash(usage.identity) !== jsonHash(capture.identity) ||
      usage.sourceId !== capture.sourceId || usage.basis.kind !== 'invocation' || usage.reporting !== 'delta' || usage.inclusion !== 'self' ||
      !originalNativeOwnerScope(usage, path) || usage.scope?.turn !== capture.proof.turn || usage.scope.turnIndex !== capture.proof.turnIndex ||
      !usage.projection.complete || usage.coverage !== 'complete' || jsonHash(usage.projection.contribution) !== jsonHash(before.step.usage) ||
      !model || model.revision !== (usage.projection.modelRevision ?? usage.revision) || model.modelRef !== usage.modelRef ||
      jsonHash(model.meter) !== jsonHash({ identity: usage.identity, sourceId: usage.sourceId, recordId: usage.recordId }) ||
      model.turn !== usage.scope.turn || model.turnIndex !== usage.scope.turnIndex ||
      jsonHash(model.actualModel) !== jsonHash(actualModel) || (actualModel === null ? null : jsonHash(actualModel)) !== usage.modelRef) return;
  return { meter: { identity: usage.identity, sourceId: usage.sourceId, recordId: usage.recordId },
    sourceNamespace: path.sourceNamespace, sessionId: before.step.id, stepId: before.step.stepId,
    originalPassKey: 'legacy:' + capture.id, lastPassKey: before.source.passKey,
    lastWatermark: before.source.original.ack.sourceWatermark, lastStepFingerprint: before.fingerprint,
    sourceSequenceKey: nativeSourceSequenceKey(before), evidenceRevision: usage.projection.observedRevision, referenceState: 'legacy-adoption' };
}
