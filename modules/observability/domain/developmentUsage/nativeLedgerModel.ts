import type { UsageRecord } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';
import { developmentCaptureSourceId, type DevelopmentModelEvidence } from '../developmentNative';
import type { UsageEvidence } from '../usageProjection';

/** Original accepted model metadata plus the exact raw revision; no configured model fallback. */
export interface NativeModelProof { readonly model: DevelopmentModelEvidence; readonly evidence: UsageEvidence }
export function qualifyNativeModel(usage: UsageRecord, proof: NativeModelProof | undefined) {
  if (!proof || usage.modelRef === null) return;
  const { model, evidence } = proof, revision = usage.projection.modelRevision ?? usage.revision;
  const owner = (value: UsageEvidence) => ({ identity: value.identity, sourceId: value.sourceId, recordId: value.recordId,
    scope: value.scope, basis: value.basis, reporting: value.reporting, inclusion: value.inclusion });
  if (model.revision !== revision || evidence.revision !== revision || model.modelRef !== usage.modelRef ||
      evidence.modelRef !== model.modelRef || model.actualModel === null || jsonHash(model.actualModel) !== model.modelRef ||
      !model.actualModel.provider || !model.actualModel.model || model.measurementFingerprint !== jsonHash(evidence) ||
      jsonHash(model.meter) !== jsonHash({ identity: usage.identity, sourceId: usage.sourceId, recordId: usage.recordId }) ||
      model.turn !== (usage.scope?.turn ?? null) || model.turnIndex !== (usage.scope?.turnIndex ?? null) ||
      developmentCaptureSourceId(model.streamSourceId, model.turn, model.turnIndex) !== usage.sourceId ||
      jsonHash(owner(evidence)) !== jsonHash(owner(usage))) return;
  return { modelRef: model.modelRef, modelRevision: revision };
}
