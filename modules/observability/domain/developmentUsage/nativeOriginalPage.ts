import { DevelopmentNativePageEvidenceSchema, NativeUsagePassPageSchema,
  type DevelopmentNativePageEvidence, type NativeUsagePassPage } from '@crewstation/contracts';
import { conflict, jsonHash, textHash } from '@crewstation/kernel';
import type { DevelopmentNativePassMetadata, DevelopmentNativePageMetadata } from './metadata';

export interface NativeOriginalStepReference {
  readonly sessionId: string; readonly stepId: string; readonly index: number; readonly fingerprint: string;
}
export interface NativeOriginalPage {
  readonly passKey: string; readonly pass: DevelopmentNativePassMetadata;
  readonly retained: DevelopmentNativePageMetadata; readonly original: DevelopmentNativePageEvidence;
  readonly page: NativeUsagePassPage;
}
/** Read the retained original document after ordinary ACK; never reconstruct a source frame. */
export function prepareNativeOriginalPage(input: {
  readonly passKey: string; readonly pass: DevelopmentNativePassMetadata;
  readonly retained: DevelopmentNativePageMetadata; readonly original: DevelopmentNativePageEvidence;
  readonly references: readonly NativeOriginalStepReference[]; readonly packetsComplete: boolean;
}): NativeOriginalPage {
  const original = DevelopmentNativePageEvidenceSchema.parse(input.original);
  const page = NativeUsagePassPageSchema.parse(JSON.parse(original.document));
  const { pass, retained } = input, source = pass.admission.identity;
  if (!input.packetsComplete || input.passKey !== jsonHash({ streamSourceId: pass.streamSourceId, passId: source.passId }) ||
      jsonHash(original.key) !== jsonHash(pass.key) || jsonHash(original.key) !== jsonHash(pass.registration.key) ||
      original.podUid !== pass.registration.podUid || jsonHash(original.preparation) !== jsonHash(pass.preparation) ||
      jsonHash(original.admission) !== jsonHash(pass.admission) || original.baselineKind !== pass.baselineKind ||
      original.rootCreatedAt !== pass.rootCreatedAt || jsonHash(page.identity) !== jsonHash(source) ||
      source.lineageKey !== pass.selection.expectedNamespace || pass.selection.version !== 2)
    throw conflict('原生数值工作必须重读已持久 packet 的同一独立原页与登记');
  const keys = ['ordinal', 'cursor', 'nextCursor', 'previousDigest', 'payloadDigest', 'cumulativeDigest',
    'scanPositionBefore', 'scanPositionAfter', 'scannedRawRows', 'counts', 'eof', 'issues'] as const;
  const packetCount = Math.max(1, Math.ceil(page.steps.length / 100));
  if (retained.originalDocumentDigest !== textHash(original.document) ||
      jsonHash(retained.ack) !== jsonHash(original.ack) || keys.some(key => jsonHash(retained[key]) !== jsonHash(page[key])) ||
      retained.packetCount !== packetCount || retained.sequenceThrough !== original.ack.sourceWatermark ||
      BigInt(retained.sequenceFrom) < 1n || BigInt(retained.sequenceThrough) !== BigInt(retained.sequenceFrom) + BigInt(packetCount) - 1n)
    throw conflict('原生数值工作不能替换原页字节、范围、ACK或原 packet 序列');
  const references = new Map(input.references.map(reference => [reference.index, reference]));
  if (references.size !== input.references.length || references.size !== page.steps.length || page.steps.some((step, index) => {
    const reference = references.get(index);
    return !reference || reference.sessionId !== step.id || reference.stepId !== step.stepId || reference.fingerprint !== jsonHash(step);
  })) throw conflict('原生数值工作的步骤必须等于原 document 逐条保留的全部引用');
  return { passKey: input.passKey, pass, retained, original, page };
}

export interface NativeOriginalStep {
  readonly source: NativeOriginalPage; readonly index: number;
  readonly step: NativeUsagePassPage['steps'][number]; readonly fingerprint: string;
}
export function originalNativeStep(source: NativeOriginalPage, index: number): NativeOriginalStep {
  if (!Number.isInteger(index) || index < 0 || index >= source.page.steps.length)
    throw conflict('原生步骤位置不属于当前真实原页');
  const step = source.page.steps[index]!;
  return { source, index, step, fingerprint: jsonHash(step) };
}
