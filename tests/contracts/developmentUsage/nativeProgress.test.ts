import { expect, test } from 'bun:test';
import { NativeUsagePassPageSchema, type NativeUsagePassPage } from '../../../packages/contracts/index';
import { textHash } from '../../../packages/kernel/index';
import { prepareDevelopmentNativePacket } from '../../../modules/observability/domain/developmentUsage/packet';
import { advanceDevelopmentNativeProgress, initialDevelopmentNativeProgress, type DevelopmentNativePassProgress } from '../../../modules/observability/domain/developmentUsage/progress';
import { nativePassFixture } from './nativePassFixture';

// Deliberately re-sign a changed fixture page to exercise population/progress checks beyond stale digests.
function resign(page: NativeUsagePassPage): void {
  const body = { identity: page.identity, ordinal: page.ordinal, scanPositionBefore: page.scanPositionBefore,
    scanPositionAfter: page.scanPositionAfter, scannedRawRows: page.scannedRawRows, counts: page.counts,
    sessions: page.sessions, steps: page.steps, issues: page.issues, eof: page.eof };
  page.payloadDigest = textHash(JSON.stringify(body));
  page.cumulativeDigest = textHash(JSON.stringify([page.previousDigest, page.payloadDigest]));
  page.nextCursor = page.eof ? null : JSON.stringify([page.identity.passId, String(BigInt(page.ordinal) + 1n), page.cumulativeDigest]);
}
test('the actual original WAL pass keeps all 1201 steps and parents deeper than 64 through its real EOF', async () => {
  const source = await nativePassFixture();
  try {
    let cursor: string | null = source.reader.initialCursor, pages = 0;
    let progress: DevelopmentNativePassProgress | undefined;
    const ids = new Set<string>(), totals = { input: 0n, cacheRead: 0n, cacheWrite: 0n, output: 0n };
    while (cursor !== null) {
      const raw = source.reader.next(cursor), packets = source.packets(raw).map(prepareDevelopmentNativePacket);
      progress ??= initialDevelopmentNativeProgress(packets[0]!);
      expect(raw.ordinal).toBe(String(pages++));
      progress = advanceDevelopmentNativeProgress(progress, packets[0]!);
      for (const packet of packets) for (const row of packet.measurements) {
        expect(ids.has(row.stepId)).toBe(false); ids.add(row.stepId);
        for (const bucket of ['input', 'cacheRead', 'cacheWrite', 'output'] as const) totals[bucket] += BigInt(row.usage[bucket]!);
        expect(row.model).toEqual({ provider: 'fixture-provider', id: 'fixture-model' });
      }
      source.reader.acknowledge(raw.ordinal, raw.payloadDigest); cursor = raw.nextCursor;
    }
    expect(progress!.eof).toBe(true); expect(progress!.counts).toEqual({ sessions: '71', parts: '2402', steps: '1201' });
    expect(ids.size).toBe(1201); expect(pages).toBeGreaterThan(64);
    expect(totals).toEqual({ input: 721801n, cacheRead: 3603n, cacheWrite: 6005n, output: 3603n });
  } finally { await source.close(); }
});
test('unknown root birth remains unknown even after the actual source pass reaches EOF', async () => {
  const source = await nativePassFixture(1, 0, false);
  try {
    const raw = source.reader.next(source.reader.initialCursor), packet = prepareDevelopmentNativePacket(source.packets(raw)[0]!);
    const result = advanceDevelopmentNativeProgress(initialDevelopmentNativeProgress(packet), packet);
    expect(result.eof).toBe(true); expect(packet.original.rootCreatedAt).toBeNull();
    expect(packet.original.baselineKind).toBe('fresh'); expect(packet.measurements[0]!.usage.input).toBe('1');
  } finally { await source.close(); }
});
test('changed original digests, cursor, scan position, counts or source watermark cannot advance a pass', async () => {
  const source = await nativePassFixture(80, 0);
  try {
    const raw = source.reader.next(source.reader.initialCursor);
    const original = prepareDevelopmentNativePacket(source.packets(raw)[0]!), initial = initialDevelopmentNativeProgress(original);
    const mutations: Array<(page: NativeUsagePassPage) => void> = [
      (p) => { p.ordinal = '1'; }, (p) => { p.cursor = 'different'; }, (p) => { p.previousDigest = 'f'.repeat(64); },
      (p) => { p.payloadDigest = 'f'.repeat(64); }, (p) => { p.cumulativeDigest = 'f'.repeat(64); },
      (p) => { p.nextCursor = 'different'; }, (p) => { p.scanPositionBefore = '1'; p.scanPositionAfter = String(BigInt(p.scannedRawRows) + 1n); resign(p); },
      (p) => { p.counts.sessions = String(BigInt(p.counts.sessions) + 1n); resign(p); },
      (p) => { p.counts.steps = String(BigInt(p.counts.steps) + 1n); resign(p); },
      (p) => { p.counts.parts = String(BigInt(p.scannedRawRows) + 1n); resign(p); },
    ];
    for (const mutate of mutations) {
      const page = NativeUsagePassPageSchema.parse(structuredClone(raw)); mutate(page);
      const packet = prepareDevelopmentNativePacket(source.packets(page)[0]!);
      expect(() => advanceDevelopmentNativeProgress(initial, packet)).toThrow('完整人口');
    }
    const wrongWatermark = { ...initial, sourceWatermark: String(Number.MAX_SAFE_INTEGER) };
    expect(() => advanceDevelopmentNativeProgress(wrongWatermark, original)).toThrow('完整人口');
  } finally { await source.close(); }
});
test('successive original pages cannot be skipped, replayed or consumed after source EOF', async () => {
  const source = await nativePassFixture(80, 0);
  try {
    const raw = source.reader.next(source.reader.initialCursor), first = prepareDevelopmentNativePacket(source.packets(raw)[0]!);
    const initial = initialDevelopmentNativeProgress(first), next = advanceDevelopmentNativeProgress(initial, first);
    expect(() => advanceDevelopmentNativeProgress(next, first)).toThrow('完整人口');
    source.reader.acknowledge(raw.ordinal, raw.payloadDigest);
    const secondRaw = source.reader.next(raw.nextCursor!), second = prepareDevelopmentNativePacket(source.packets(secondRaw)[0]!);
    expect(() => advanceDevelopmentNativeProgress(initial, second)).toThrow('完整人口');
    expect(advanceDevelopmentNativeProgress(next, second).ordinal).toBe('2');
    expect(() => advanceDevelopmentNativeProgress({ ...next, eof: true }, second)).toThrow('完整人口');
  } finally { await source.close(); }
});
test('initial progress stays bound to the original admission instead of a caller-selected starting page', async () => {
  const source = await nativePassFixture(1, 0);
  try {
    const packet = prepareDevelopmentNativePacket(source.packets(source.reader.next(source.reader.initialCursor))[0]!);
    packet.original.admission.initialCursor = 'different';
    expect(() => initialDevelopmentNativeProgress(packet)).toThrow('初始游标');
  } finally { await source.close(); }
});
test('original decimal checkpoints advance exactly beyond Number.MAX_SAFE_INTEGER without population caps', async () => {
  const source = await nativePassFixture(1, 0);
  try {
    const original = source.reader.next(source.reader.initialCursor), packet = prepareDevelopmentNativePacket(source.packets(original)[0]!);
    const raw = NativeUsagePassPageSchema.parse(original);
    const initial = initialDevelopmentNativeProgress(packet), large = 1000000000000000000000000n;
    const previous = { ...initial, ordinal: String(large), cursor: JSON.stringify([raw.identity.passId, String(large), initial.previousDigest]),
      scanPosition: String(large), counts: { sessions: String(large), parts: String(large), steps: String(large) } };
    raw.ordinal = previous.ordinal; raw.cursor = previous.cursor; raw.scanPositionBefore = previous.scanPosition;
    raw.scanPositionAfter = String(large + BigInt(raw.scannedRawRows));
    raw.counts = { sessions: String(large + BigInt(raw.sessions.length)), parts: String(large + 2n), steps: String(large + BigInt(raw.steps.length)) };
    raw.eof = { fingerprint: raw.eof!.fingerprint, counts: raw.counts }; resign(raw);
    const result = advanceDevelopmentNativeProgress(previous, prepareDevelopmentNativePacket(source.packets(raw)[0]!));
    expect(result.ordinal).toBe('1000000000000000000000001'); expect(result.counts.steps).toBe('1000000000000000000000001');
    expect(result.scanPosition).toBe('1000000000000000000000003'); expect(result.eof).toBe(true);
  } finally { await source.close(); }
});
