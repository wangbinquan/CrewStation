import type { UsageRecord } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';
import { qualifyNativeModel, type NativeModelProof } from './nativeLedgerModel';
type UsageMeasurementRef = Pick<UsageRecord, 'identity' | 'sourceId' | 'recordId'>;

/** References the one original evidence ledger; this document contains no Token or CNY values. */
export interface NativeLedgerReference {
  readonly version: 2; readonly meter: UsageMeasurementRef; readonly ownerKey: string;
  readonly passKey: string; readonly ordinal: string; readonly stepIndex: number;
  readonly sourceSequenceKey: string; readonly sourceWatermark: string;
  readonly evidenceRevision: number; readonly evidenceFingerprint: string;
  readonly scopeFingerprint: string; readonly stepFingerprint: string;
}
export function isNativeLedgerReference(value: object): value is NativeLedgerReference {
  return 'version' in value && value.version === 2;
}
/** Every writer compares the final original projection once, after resolving the exact original evidence reference. */
export function projectNativeLedgerReference(raw: UsageRecord, previous: UsageRecord | undefined,
  reference: NativeLedgerReference, anchored: UsageRecord | undefined,
  models: { incoming?: NativeModelProof; previous?: NativeModelProof } = {}): UsageRecord {
  const valid = anchored !== undefined && jsonHash(reference.meter) === jsonHash({
    identity: anchored.identity, sourceId: anchored.sourceId, recordId: anchored.recordId,
  }) && jsonHash(anchored.scope) === reference.scopeFingerprint && anchored.revision === reference.evidenceRevision;
  const retained = valid ? anchored! : previous ?? raw;
  const sameOwner = jsonHash({ identity: raw.identity, sourceId: raw.sourceId, recordId: raw.recordId, scope: raw.scope,
    basis: raw.basis, reporting: raw.reporting, inclusion: raw.inclusion }) === jsonHash({
    identity: retained.identity, sourceId: retained.sourceId, recordId: retained.recordId, scope: retained.scope,
    basis: retained.basis, reporting: retained.reporting, inclusion: retained.inclusion,
  });
  const diagnosticIssues = raw.projection.issues.filter(issue => issue === 'identity-conflict' || issue === 'invalid-final');
  const priorModel = retained.modelRef !== null ? { modelRef: retained.modelRef,
    modelRevision: retained.projection.modelRevision ?? retained.revision } :
    previous && qualifyNativeModel(previous, models.previous);
  const incomingModel = sameOwner && valid ? qualifyNativeModel(raw, models.incoming) : undefined;
  const selectedModel = priorModel ?? incomingModel;
  const conflict = !valid || !sameOwner || raw.modelRef !== null &&
    (!incomingModel || selectedModel?.modelRef !== raw.modelRef);
  const revision = previous?.projection.projectionRevision ?? 0;
  const candidate: UsageRecord = { ...retained, ...(selectedModel ? { modelRef: selectedModel.modelRef } : {}),
    projection: { ...retained.projection, ...(selectedModel ? { modelRevision: selectedModel.modelRevision } : {}),
    observedRevision: Math.max(raw.projection.observedRevision, retained.projection.observedRevision), projectionRevision: revision,
    ...(conflict || diagnosticIssues.length ? { complete: false, issues: [...new Set([...retained.projection.issues, ...diagnosticIssues,
      ...(conflict ? ['identity-conflict' as const] : [])])] } : {}) } };
  if (previous && jsonHash(previous) === jsonHash(candidate)) return previous;
  if (revision === Number.MAX_SAFE_INTEGER) throw new RangeError('Usage projection revision exhausted');
  return { ...candidate, projection: { ...candidate.projection, projectionRevision: revision + 1 } };
}
