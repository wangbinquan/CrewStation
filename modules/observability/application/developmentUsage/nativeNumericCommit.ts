import { UsageRecordSchema } from '@crewstation/contracts';
import { conflict, jsonHash } from '@crewstation/kernel';
import { rebuildUsageProjection, type UsageEvidence } from '../../domain/usageProjection';
import { type NativeOriginalStep } from '../../domain/developmentUsage/nativeOriginalPage';
import { projectNativeStep } from '../../domain/developmentUsage/nativeStepProjection';
import { nativeSourceSequenceKey, type NativeStepOwnerReceipt } from '../../domain/developmentUsage/nativeStepOwner';
import { qualifyNativeOwnerBridge } from '../../domain/developmentUsage/nativeOwnerBridge';
import { qualifyNativeLegacyAdoption } from '../../domain/developmentUsage/nativeLegacyAdoption';
import type { NativeBaselineQualification } from '../../domain/developmentUsage/nativeBaselineQualification';
import type { NativeDevelopmentTransaction } from '../../ports/nativeDevelopmentLedger';
import type { CompleteNativePath } from '../../ports/completeNativeScope';

async function retainNumeric(tx: NativeDevelopmentTransaction, original: NativeOriginalStep,
  path: CompleteNativePath, evidence: UsageEvidence, actualModel: Parameters<NativeDevelopmentTransaction['developmentModel']>[0]['actualModel'], streamSourceId: string) {
  const fingerprint = jsonHash(evidence), source = original.source;
  const sequence = Number(BigInt(source.retained.sequenceFrom) + BigInt(Math.floor(original.index / 100)));
  if (!Number.isSafeInteger(sequence)) throw conflict('原模型位置必须属于同一原普通packet序列');
  await tx.developmentModel({ meter: { identity: evidence.identity, sourceId: evidence.sourceId, recordId: evidence.recordId },
    revision: evidence.revision, streamSourceId, sequence, index: original.index % 100,
    turn: evidence.scope?.turn ?? null, turnIndex: evidence.scope?.turnIndex ?? null,
    measurementFingerprint: fingerprint, actualModel, modelRef: evidence.modelRef,
    native: { passKey: source.passKey, ordinal: source.page.ordinal, stepIndex: original.index,
      originalDocumentDigest: source.retained.originalDocumentDigest, sourceTurn: source.page.identity.turn,
      sourceTurnIndex: source.pass.preparation.turnIndex, sourceWatermark: source.original.ack.sourceWatermark } });
  const event = { eventId: 'native-page:' + jsonHash({ passKey: source.passKey, step: original.step.stepId }), measurement: evidence };
  const retainedEvent = await tx.eventFingerprint(event.eventId), retainedRevision = await tx.revisionFingerprint(evidence);
  if (retainedEvent !== undefined && retainedEvent !== fingerprint || retainedRevision !== undefined && retainedRevision !== fingerprint)
    throw conflict('原生同一原页步骤或原 meter 修订发生冲突');
  if (retainedEvent === undefined) await tx.append(event, fingerprint);
  await tx.nativeReference({ version: 2, meter: { identity: evidence.identity, sourceId: evidence.sourceId, recordId: evidence.recordId },
    ownerKey: jsonHash({ sourceNamespace: path.sourceNamespace, sessionId: path.session, stepId: original.step.stepId }),
    passKey: source.passKey, ordinal: source.page.ordinal, stepIndex: original.index,
    sourceSequenceKey: nativeSourceSequenceKey(original), sourceWatermark: source.original.ack.sourceWatermark,
    evidenceRevision: evidence.revision, evidenceFingerprint: fingerprint, scopeFingerprint: jsonHash(evidence.scope), stepFingerprint: original.fingerprint });
  const samples: UsageEvidence[] = [];
  for (let after = 0;;) {
    const page = await tx.evidence(evidence, after, 200); samples.push(...page);
    if (page.length < 200) break;
    after = page.at(-1)!.revision;
  }
  const projected = UsageRecordSchema.parse(rebuildUsageProjection(samples, await tx.current(evidence)));
  await tx.project(projected, evidence);
  return (await tx.current(evidence))!;
}
export async function commitNativeOriginalStep(input: { tx: NativeDevelopmentTransaction; original: NativeOriginalStep;
  baseline: NativeBaselineQualification; before?: NativeOriginalStep; observedAt: string }): Promise<readonly string[]> {
  const { tx, original, baseline, before } = input;
  const path = await tx.nativePath(original.source.passKey, original.step.id);
  if (!path) return ['native-original-step-path-unmatched'];
  let owner = await tx.nativeOwner(path.sourceNamespace, original.step.id, original.step.stepId);
  if (owner.state === 'missing') {
    const candidates = await tx.nativeLegacyOwners(path, before ?? original);
    const adopted = before ? qualifyNativeLegacyAdoption(before, path, candidates) : undefined;
    if (adopted) { await tx.nativeClaim(adopted, path); owner = await tx.nativeOwner(path.sourceNamespace, original.step.id, original.step.stepId); }
    else if (candidates.length) return ['native-owner-unresolved'];
  }
  const priorModel = owner.usage ? await tx.nativeOriginalModel(owner.receipt!.meter,
    owner.usage.projection.modelRevision ?? owner.usage.revision) : undefined;
  if (owner.usage && owner.receipt && before && baseline.state === 'complete-before' &&
      owner.receipt.sourceSequenceKey !== nativeSourceSequenceKey(original)) {
    const bridge = qualifyNativeOwnerBridge({ owner: owner.usage, receipt: owner.receipt, model: priorModel, before, path });
    if (bridge) { await tx.nativeClaim(bridge, path); owner = await tx.nativeOwner(path.sourceNamespace, original.step.id, original.step.stepId); }
  }
  const projection = projectNativeStep({ original, path, baseline, beforeStep: before?.step,
    originalOwner: owner.usage, ownerReceipt: owner.receipt, ownerResolution: owner.state,
    originalModel: priorModel?.actualModel, observedAt: input.observedAt });
  if (projection.state === 'held') return projection.issues;
  if (projection.state === 'unchanged' && projection.outdated) return [];
  const usage = projection.state === 'write' ? await retainNumeric(tx, original, path, projection.evidence,
    projection.actualModel, priorModel?.streamSourceId ?? original.source.pass.streamSourceId) : projection.owner;
  const receipt: NativeStepOwnerReceipt = { meter: { identity: usage.identity, sourceId: usage.sourceId, recordId: usage.recordId },
    sourceNamespace: path.sourceNamespace, sessionId: original.step.id, stepId: original.step.stepId,
    originalPassKey: owner.receipt?.originalPassKey ?? original.source.passKey, lastPassKey: original.source.passKey,
    lastWatermark: original.source.original.ack.sourceWatermark, lastStepFingerprint: original.fingerprint,
    sourceSequenceKey: nativeSourceSequenceKey(original), evidenceRevision: projection.state === 'write' ? projection.evidence.revision :
      owner.receipt?.evidenceRevision ?? usage.revision, referenceState: 'projected',
    ...(owner.receipt?.bridge ? { bridge: owner.receipt.bridge } : {}) };
  await tx.nativeClaim(receipt, path);
  return [];
}
