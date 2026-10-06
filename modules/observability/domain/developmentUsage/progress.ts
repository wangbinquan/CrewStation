import type { NativeUsagePassIdentity, NativeUsagePassPage } from '@crewstation/contracts';
import { conflict, jsonHash, textHash } from '@crewstation/kernel';
import type { DevelopmentNativePacket } from './packet';

/** Source progress only. Source EOF never proves a zero baseline or complete numeric usage. */
export interface DevelopmentNativePassProgress {
  identity: NativeUsagePassIdentity; ordinal: string; cursor: string | null;
  previousDigest: string; scanPosition: string; counts: NativeUsagePassPage['counts'];
  sourceWatermark: string; eof: boolean;
}
function originalPage(packet: DevelopmentNativePacket): NativeUsagePassPage {
  return JSON.parse(packet.original.document) as NativeUsagePassPage;
}
/** Match the original reader/journal's JSON byte ordering, without reconstructing its document. */
function payloadDigest(raw: NativeUsagePassPage): string {
  const body = { identity: raw.identity, ordinal: raw.ordinal, scanPositionBefore: raw.scanPositionBefore,
    scanPositionAfter: raw.scanPositionAfter, scannedRawRows: raw.scannedRawRows, counts: raw.counts,
    sessions: raw.sessions, steps: raw.steps, issues: raw.issues, eof: raw.eof };
  return textHash(JSON.stringify(body));
}
export function initialDevelopmentNativeProgress(packet: DevelopmentNativePacket): DevelopmentNativePassProgress {
  const raw = originalPage(packet), admission = packet.original.admission;
  const previousDigest = textHash(JSON.stringify(raw.identity));
  if (admission.initialCursor !== JSON.stringify([raw.identity.passId, '0', previousDigest]))
    throw conflict('原生 pass 必须从原准入的真实初始游标开始');
  return { identity: raw.identity, ordinal: '0', cursor: admission.initialCursor, previousDigest,
    scanPosition: '0', counts: { sessions: '0', parts: '0', steps: '0' },
    sourceWatermark: admission.sourceWatermark, eof: false };
}
/** Call only after every packet of this original page is durably retained. */
export function advanceDevelopmentNativeProgress(previous: DevelopmentNativePassProgress, packet: DevelopmentNativePacket): DevelopmentNativePassProgress {
  const page = originalPage(packet), source = packet.event.capture;
  if (source.version !== 2) throw conflict('原生 pass 不能被旧帧推进');
  const payload = payloadDigest(page), cumulative = textHash(JSON.stringify([previous.previousDigest, payload]));
  const nextOrdinal = String(BigInt(page.ordinal) + 1n);
  if (previous.eof || jsonHash(page.identity) !== jsonHash(previous.identity) || page.ordinal !== previous.ordinal ||
      page.cursor !== previous.cursor || page.scanPositionBefore !== previous.scanPosition || page.previousDigest !== previous.previousDigest ||
      page.payloadDigest !== payload || page.cumulativeDigest !== cumulative ||
      page.nextCursor !== (page.eof ? null : JSON.stringify([page.identity.passId, nextOrdinal, cumulative])) ||
      BigInt(source.nativeSource.sequenceFrom) <= BigInt(previous.sourceWatermark) ||
      BigInt(page.counts.sessions) !== BigInt(previous.counts.sessions) + BigInt(page.sessions.length) ||
      BigInt(page.counts.steps) !== BigInt(previous.counts.steps) + BigInt(page.steps.length) ||
      BigInt(page.counts.parts) < BigInt(previous.counts.parts) ||
      BigInt(page.counts.parts) - BigInt(previous.counts.parts) > BigInt(page.scannedRawRows))
    throw conflict('原生 pass 的连续原页、摘要、扫描进度或完整人口不符');
  return { identity: page.identity, ordinal: nextOrdinal, cursor: page.nextCursor,
    previousDigest: cumulative, scanPosition: page.scanPositionAfter, counts: page.counts,
    sourceWatermark: source.nativeSource.ack.sourceWatermark, eof: page.eof !== null };
}
