import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { DevelopmentNativePageEvidenceSchema, type DevelopmentUsageEvent } from '@crewstation/contracts';
import { originalNativePage, assertOriginalNativePacket } from './developmentNativeEvidence';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fixture(empty = false) {
  const store = { state: 'observed' as const, sourceEpoch: crypto.randomUUID(), actualPathDigest: 'a'.repeat(64), fileIdentityDigest: 'b'.repeat(64) };
  const preparation = { turn: 'turn', turnIndex: 0, rootSessionId: 'root', observedAt: '2026-10-05T00:00:00.000Z', store };
  const identity = { passId: 'pass', turn: preparation.turn, nativeSource: 'opencode:' + store.actualPathDigest,
    sourceGeneration: hash(store), rootSessionId: 'root', lineageKey: 'lineage', epoch: store.sourceEpoch, phase: 'final' as const };
  const counts = { sessions: '1', parts: empty ? '0' : '2', steps: empty ? '0' : '2' };
  const steps = empty ? [] : [0, 1].map((n) => ({ id: 'root', parentSessionId: null, stepId: 'step-' + n,
    occurredAt: null, usage: { input: '9007199254740993', cacheRead: '7', cacheWrite: '0', output: null }, model: null }));
  const body = { identity, ordinal: '0', scanPositionBefore: '0', scanPositionAfter: empty ? '1' : '3', scannedRawRows: empty ? '1' : '3',
    counts, sessions: [{ id: 'root', parentSessionId: null }], steps, issues: [], eof: { fingerprint: 'c'.repeat(64), counts } };
  const payloadDigest = hash(body), cumulativeDigest = hash(['d'.repeat(64), payloadDigest]);
  const page = { ...body, cursor: 'start', nextCursor: null, previousDigest: 'd'.repeat(64), payloadDigest, cumulativeDigest };
  const ack = { contract: 'native-usage-page-ack-v2' as const, identity, ownerReceiptId: 'owner', ordinal: '0', payloadDigest, cumulativeDigest,
    scanPositionAfter: body.scanPositionAfter, counts, nextCursor: null, sourceWatermark: empty ? '1' : '2', eof: body.eof };
  const evidence = DevelopmentNativePageEvidenceSchema.parse({ version: 2, key: { executionId: '019f0000-0000-7000-8000-000000000003', journalId: crypto.randomUUID(), incarnation: crypto.randomUUID(), payloadDigest: 'e'.repeat(64) },
    podUid: 'pod', preparation, baselineKind: 'fresh', rootCreatedAt: null,
    admission: { identity, initialCursor: 'start', ownerReceiptId: 'owner', sourceWatermark: '0' }, ack, document: JSON.stringify(page) });
  const event = (index = 0): DevelopmentUsageEvent => ({ sequence: index + 1, occurredAt: preparation.observedAt, capture: { version: 2,
    nativeSource: { version: 2, stage: 'page', turnIndex: 0, ack, sequenceFrom: 1, sequenceThrough: empty ? 1 : 2,
      sequence: index + 1, packetIndex: index, packetCount: empty ? 1 : 2 }, measurements: empty ? [] : [steps[index]!], diagnostics: [] } });
  return { evidence, page, event };
}
test('original page order, arbitrary precision buckets and unknowns survive the shared pure validator', () => {
  const f = fixture(); expect(originalNativePage(f.evidence)).toEqual(f.page);
  expect(originalNativePage(f.evidence).steps[0]!.usage).toEqual({ input: '9007199254740993', output: null, cacheRead: '7', cacheWrite: '0' });
  expect(() => assertOriginalNativePacket(f.evidence, f.event(0))).not.toThrow();
  expect(() => assertOriginalNativePacket(f.evidence, f.event(1))).not.toThrow();
});
test('changed original body, cumulative digest and source generation cannot masquerade as retained numeric evidence', () => {
  const f = fixture(), changed = structuredClone(f.page); changed.steps[0]!.usage.input = '9';
  expect(() => originalNativePage({ ...f.evidence, document: JSON.stringify(changed) })).toThrow('原内容');
  const wrong = { ...f.evidence, preparation: { ...f.evidence.preparation, store: { ...f.evidence.preparation.store, fileIdentityDigest: 'f'.repeat(64) } } };
  expect(() => originalNativePage(wrong)).toThrow('准备身份');
  const bad = { ...f.page, cumulativeDigest: 'f'.repeat(64) };
  expect(() => originalNativePage({ ...f.evidence, document: JSON.stringify(bad), ack: { ...f.evidence.ack, cumulativeDigest: bad.cumulativeDigest } })).toThrow('累计摘要');
});
test('each packet retains its frozen ACK, actual time/turn, original contiguous membership and first/last boundaries', () => {
  const f = fixture(), first = f.event(), capture = first.capture;
  if (capture.version !== 2) throw new Error('actual v2 fixture');
  const changed = [
    { ...first, occurredAt: '2026-10-05T00:00:01.000Z' },
    { ...first, capture: { ...capture, nativeSource: { ...capture.nativeSource, turnIndex: 1 } } },
    { ...first, capture: { ...capture, nativeSource: { ...capture.nativeSource, ack: { ...capture.nativeSource.ack, ownerReceiptId: 'other' } } } },
    { ...first, capture: { ...capture, measurements: [f.page.steps[1]!] } },
    { ...f.event(1), capture: { ...capture, nativeSource: { ...capture.nativeSource, packetIndex: 1 }, measurements: [f.page.steps[0]!] } },
    { ...first, capture: { ...capture, measurements: [] } },
    { ...first, capture: { ...capture, measurements: [...f.page.steps, f.page.steps[0]!] } },
  ] as DevelopmentUsageEvent[];
  for (const value of changed) expect(() => assertOriginalNativePacket(f.evidence, value)).toThrow();
});
test('an original empty page remains one empty packet and does not grant token-completeness', () => {
  const f = fixture(true); expect(() => assertOriginalNativePacket(f.evidence, f.event())).not.toThrow();
  const event = f.event(), capture = event.capture; if (capture.version !== 2) throw new Error('actual v2 fixture');
  expect(() => assertOriginalNativePacket(f.evidence, { ...event, capture: { ...capture, nativeSource: { ...capture.nativeSource, packetCount: 2 } } })).toThrow();
});
test('full evidence schema rejects mismatching raw ACK, invented EOF, invalid JSON and unknown fields', () => {
  const f = fixture();
  for (const value of [{ ...f.evidence, extra: true }, { ...f.evidence, document: 'not-json' },
    { ...f.evidence, document: JSON.stringify({ ...f.page, ordinal: '1' }) },
    { ...f.evidence, document: JSON.stringify({ ...f.page, eof: null }) }])
    expect(DevelopmentNativePageEvidenceSchema.safeParse(value).success).toBe(false);
});
