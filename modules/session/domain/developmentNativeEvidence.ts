import { createHash } from 'node:crypto';
import { DevelopmentNativePageEvidenceSchema, type DevelopmentNativePageEvidence, type DevelopmentUsageEvent, type NativeUsagePassPage } from '@crewstation/contracts';
import { conflict, jsonHash } from '@crewstation/kernel';

const originalDigest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Preserve the producer's original JSON byte/order convention, rather than a sorted JSONB hash. */
export function originalNativePage(value: DevelopmentNativePageEvidence): NativeUsagePassPage {
  const evidence = DevelopmentNativePageEvidenceSchema.parse(value), raw = JSON.parse(evidence.document) as NativeUsagePassPage;
  const body = { identity: raw.identity, ordinal: raw.ordinal, scanPositionBefore: raw.scanPositionBefore,
    scanPositionAfter: raw.scanPositionAfter, scannedRawRows: raw.scannedRawRows, counts: raw.counts,
    sessions: raw.sessions, steps: raw.steps, issues: raw.issues, eof: raw.eof };
  const payload = originalDigest(body);
  if (payload !== raw.payloadDigest || originalDigest([raw.previousDigest, payload]) !== raw.cumulativeDigest ||
      raw.identity.sourceGeneration !== originalDigest(evidence.preparation.store))
    throw conflict('原页副本与原内容、累计摘要或准备身份不符');
  return raw;
}
/** Each numeric packet retains its original page membership; this grants no token-completeness claim. */
export function assertOriginalNativePacket(evidence: DevelopmentNativePageEvidence, event: DevelopmentUsageEvent): void {
  const raw = originalNativePage(evidence), capture = event.capture;
  if (capture.version !== 2 || jsonHash(capture.nativeSource.ack) !== jsonHash(evidence.ack) ||
      capture.nativeSource.turnIndex !== evidence.preparation.turnIndex || event.occurredAt !== evidence.preparation.observedAt)
    throw conflict('数字帧与同事务原页证据不同');
  const { packetIndex, packetCount } = capture.nativeSource, rows = capture.measurements;
  if (!raw.steps.length) {
    if (rows.length || packetCount !== 1) throw conflict('原空页不能增加数字帧人口');
    return;
  }
  const start = raw.steps.findIndex((step) => step.stepId === rows[0]?.stepId);
  if (!rows.length || start < 0 || start + rows.length > raw.steps.length || (packetIndex === 0 && start !== 0) ||
      (packetIndex === packetCount - 1 && start + rows.length !== raw.steps.length) ||
      rows.some((step, index) => jsonHash(step) !== jsonHash(raw.steps[start + index])))
    throw conflict('数字帧没有保留原页连续成员');
}
