import type { UsageRecord } from '@crewstation/contracts';
type UsageMeasurementRef = Pick<UsageRecord, 'identity' | 'sourceId' | 'recordId'>;
import { jsonHash } from '@crewstation/kernel';
import { developmentNativePathDigest } from './paths';
export interface QualifiedNativePath {
  readonly root: string; readonly session: string; readonly parentSession: string | null;
  readonly depth: string; readonly pathDigest: string; readonly sourceNamespace: string;
}
type CompleteNativePath = QualifiedNativePath;
import type { NativeOriginalStep } from './nativeOriginalPage';

/** Original meter and source references only; no tokens, amounts or invented order. */
export interface NativeStepOwnerReceipt {
  readonly meter: UsageMeasurementRef; readonly sourceNamespace: string;
  readonly sessionId: string; readonly stepId: string; readonly originalPassKey: string;
  readonly lastPassKey: string; readonly lastWatermark: string; readonly lastStepFingerprint: string;
  /** Packet watermarks are comparable only within their actual original journal/execution key. */
  readonly sourceSequenceKey: string;
  readonly evidenceRevision: number; readonly referenceState: 'legacy-adoption' | 'projected';
  readonly bridge?: { readonly previousReceiptFingerprint: string; readonly previousSequenceKey: string;
    readonly previousPassKey: string; readonly previousWatermark: string; readonly beforePassKey: string;
    readonly beforeOrdinal: string; readonly beforeIndex: number; readonly beforeStepFingerprint: string;
    readonly beforeDocumentDigest: string; readonly originalProjectionRevision: number; readonly originalModelRevision: number };

}
export const pagedNativeRecordId = (step: NativeOriginalStep['step']) =>
  'opencode:step:' + jsonHash({ session: step.id, id: step.stepId });
export const nativeSourceSequenceKey = (original: NativeOriginalStep) => jsonHash({
  executionId: original.source.pass.key.executionId, journalId: original.source.pass.key.journalId,
});

export function originalNativeOwnerScope(owner: UsageRecord, path: CompleteNativePath): boolean {
  const scope = owner.scope;
  if (!scope || scope.level !== 'request' || scope.root !== path.root || scope.session !== path.session || scope.parentSession !== path.parentSession)
    return false;
  if ('native' in scope)
    return scope.native.sourceNamespace === path.sourceNamespace && scope.native.pathDigest === path.pathDigest && scope.native.depth === path.depth;
  let digest = path.sourceNamespace, parent: string | null = null;
  for (const id of [...scope.ancestors, scope.session]) {
    digest = developmentNativePathDigest(digest, id, parent); parent = id;
  }
  return String(scope.ancestors.length) === path.depth && digest === path.pathDigest;
}
export function nativeOwnerReceiptMatches(owner: UsageRecord, receipt: NativeStepOwnerReceipt,
  original: NativeOriginalStep, path: CompleteNativePath): boolean {
  return receipt.sourceNamespace === path.sourceNamespace && receipt.sessionId === original.step.id &&
    receipt.stepId === original.step.stepId && receipt.meter.recordId === owner.recordId &&
    receipt.meter.sourceId === owner.sourceId && jsonHash(receipt.meter.identity) === jsonHash(owner.identity) &&
    owner.recordId === pagedNativeRecordId(original.step) && owner.basis.kind === 'invocation' &&
    owner.reporting === 'delta' && owner.inclusion === 'self' && originalNativeOwnerScope(owner, path);
}
