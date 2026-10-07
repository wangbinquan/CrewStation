import type { UsageRecord } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';
import type { DevelopmentModelEvidence } from '../developmentNative';
import type { NativeOriginalStep } from './nativeOriginalPage';
import { nativeOwnerReceiptMatches, nativeSourceSequenceKey, type NativeStepOwnerReceipt } from './nativeStepOwner';
import type { QualifiedNativePath as CompleteNativePath } from './nativeStepOwner';

/** Different journals have no comparable watermarks. A complete actual before supplies a new explicit reference bridge. */
export function qualifyNativeOwnerBridge(input: { owner: UsageRecord; receipt: NativeStepOwnerReceipt;
  model: DevelopmentModelEvidence | undefined; before: NativeOriginalStep; path: CompleteNativePath }): NativeStepOwnerReceipt | undefined {
  const { owner, receipt, model, before, path } = input;
  const sourceSequenceKey = nativeSourceSequenceKey(before);
  const actualModel = before.step.model === null ? null : { provider: before.step.model.provider, model: before.step.model.id, condition: null };
  if (sourceSequenceKey === receipt.sourceSequenceKey || before.source.page.identity.phase !== 'baseline' ||
      receipt.referenceState !== 'projected' || !nativeOwnerReceiptMatches(owner, receipt, before, path) ||
      !owner.projection.complete || owner.coverage !== 'complete' || jsonHash(owner.projection.contribution) !== jsonHash(before.step.usage) ||
      !model || model.revision !== (owner.projection.modelRevision ?? owner.revision) || model.modelRef !== owner.modelRef ||
      jsonHash(model.meter) !== jsonHash(receipt.meter) || model.turn !== owner.scope?.turn || model.turnIndex !== owner.scope.turnIndex ||
      jsonHash(model.actualModel) !== jsonHash(actualModel) || (actualModel === null ? null : jsonHash(actualModel)) !== owner.modelRef) return;
  return { ...receipt, lastPassKey: before.source.passKey, sourceSequenceKey,
    lastWatermark: before.source.original.ack.sourceWatermark, lastStepFingerprint: before.fingerprint,
    bridge: { previousReceiptFingerprint: jsonHash(receipt), previousSequenceKey: receipt.sourceSequenceKey,
      previousPassKey: receipt.lastPassKey, previousWatermark: receipt.lastWatermark,
      beforePassKey: before.source.passKey, beforeOrdinal: before.source.page.ordinal, beforeIndex: before.index,
      beforeStepFingerprint: before.fingerprint, beforeDocumentDigest: before.source.retained.originalDocumentDigest,
      originalProjectionRevision: owner.projection.projectionRevision, originalModelRevision: model.revision } };
}
