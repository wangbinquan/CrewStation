import { jsonHash, conflict, textHash } from '@crewstation/kernel';
import type { DevelopmentNativePacket } from './packet';

/** Durable source bindings only. The original document and all numbers remain in their original stores. */
export function developmentNativeMetadata(packet: DevelopmentNativePacket) {
  const source = packet.event.capture;
  if (source.version !== 2) throw conflict('原生来源元数据只保留实际 v2 原帧');
  const { original, page, registration, streamSourceId, selection } = packet;
  const passKey = jsonHash({ streamSourceId, passId: page.identity.passId });
  const pass = { key: packet.key, registration, streamSourceId, selection,
    preparation: original.preparation, baselineKind: original.baselineKind,
    rootCreatedAt: original.rootCreatedAt, admission: original.admission };
  const document = { ordinal: page.ordinal, cursor: page.cursor, nextCursor: page.nextCursor,
    previousDigest: page.previousDigest, payloadDigest: page.payloadDigest, cumulativeDigest: page.cumulativeDigest,
    scanPositionBefore: page.scanPositionBefore, scanPositionAfter: page.scanPositionAfter,
    scannedRawRows: page.scannedRawRows, counts: page.counts, eof: page.eof, issues: page.issues,
    ack: original.ack, originalDocumentDigest: textHash(original.document),
    sequenceFrom: String(source.nativeSource.sequenceFrom), sequenceThrough: String(source.nativeSource.sequenceThrough),
    packetCount: packet.packetCount };
  return { passKey, pass, passFingerprint: jsonHash(pass), page: document, pageFingerprint: jsonHash(document),
    projectId: registration.identity.projectId, taskId: registration.identity.taskId,
    taskKey: jsonHash({ projectId: registration.identity.projectId, taskId: registration.identity.taskId }) };
}
export type DevelopmentNativePassMetadata = ReturnType<typeof developmentNativeMetadata>['pass'];
export type DevelopmentNativePageMetadata = ReturnType<typeof developmentNativeMetadata>['page'];

/** These are source references, not a second Token/model/cost ledger. */
export function developmentNativeReferences(packet: DevelopmentNativePacket) {
  return {
    sessions: packet.page.sessions.map((row) => ({ id: row.id, parentSessionId: row.parentSessionId,
      ordinal: packet.page.ordinal, fingerprint: jsonHash(row) })),
    steps: packet.page.steps.map((row, index) => ({ id: row.stepId, sessionId: row.id,
      parentSessionId: row.parentSessionId, ordinal: packet.page.ordinal, index, fingerprint: jsonHash(row) })),
  };
}
