import { expect, test } from 'bun:test';
import { NativeUsagePassAckSchema, NativeUsagePassAdmissionSchema, NativeUsagePassPageSchema } from './pages';

const digest = 'a'.repeat(64);
const identity = { passId: 'pass', turn: 'turn', nativeSource: 'source', sourceGeneration: 'generation',
  rootSessionId: 'root', lineageKey: 'lineage', epoch: 'epoch', phase: 'final' as const };
const counts = { sessions: '2', parts: '2', steps: '2' };
const sessions = [{ id: 'root', parentSessionId: null }, { id: 'child', parentSessionId: 'root' }];
const steps = sessions.map((session, index) => ({ ...session, stepId: `step-${index}`, occurredAt: null,
  usage: { input: null, cacheRead: null, cacheWrite: null, output: null }, model: null }));
const page = { identity, ordinal: '0', cursor: 'cursor', nextCursor: null, previousDigest: digest,
  payloadDigest: digest, cumulativeDigest: digest, scanPositionBefore: '0', scanPositionAfter: '4',
  scannedRawRows: '4', counts, sessions, steps, issues: [], eof: { fingerprint: digest, counts } };
const ack = { contract: 'native-usage-page-ack-v2', identity, ownerReceiptId: 'receipt', ordinal: '0',
  payloadDigest: digest, cumulativeDigest: digest, scanPositionAfter: '4', counts, nextCursor: null,
  sourceWatermark: '4', eof: page.eof };

test('native page contract retains exact large populations, unknown usage and original EOF', () => {
  const huge = '1' + '0'.repeat(100), large = { sessions: huge, parts: huge, steps: huge };
  expect(NativeUsagePassPageSchema.parse(page).steps[0]!.usage.input).toBeNull();
  expect(NativeUsagePassPageSchema.parse({ ...page, counts: large, eof: { ...page.eof, counts: large } }).counts).toEqual(large);
  expect(NativeUsagePassAckSchema.parse({ ...ack, counts: large, eof: { ...page.eof, counts: large } }).counts).toEqual(large);
  expect(NativeUsagePassPageSchema.safeParse({ ...page, nextCursor: 'next', eof: null }).success).toBe(true);
  expect(NativeUsagePassAdmissionSchema.parse({ identity, initialCursor: 'cursor', ownerReceiptId: 'receipt', sourceWatermark: huge }).sourceWatermark).toBe(huge);
});

test('native contract rejects fabricated progress, omitted population and changed parent identities', () => {
  // The shared barrel must ship its strict parser with independent contract tests, without enabling a producer.
  for (const patch of [
    { scanPositionBefore: 'bad' }, { scannedRawRows: 'bad' }, { counts: { ...counts, steps: 'bad' } },
    { ordinal: '01' }, { scanPositionBefore: '5' }, { scanPositionAfter: '5' },
    { scanPositionAfter: '1001', scannedRawRows: '1001' },
    { scannedRawRows: '3', scanPositionAfter: '3' },
    { nextCursor: 'next' }, { nextCursor: null, eof: null },
    { nextCursor: 'cursor', eof: null }, { nextCursor: 'next', eof: null, scannedRawRows: '0', scanPositionAfter: '0' },
    { eof: { ...page.eof, counts: { ...counts, steps: '3' } } },
    { sessions: [sessions[0], sessions[0]] }, { steps: [steps[0], steps[0]] },
    { sessions: [{ ...sessions[0], parentSessionId: 'child' }] },
    { sessions: [{ ...sessions[1], parentSessionId: null }] },
    { steps: [{ ...steps[1], parentSessionId: 'child' }] },
    { counts: { sessions: '0', parts: '2', steps: '2' } },
    { counts: { sessions: '2', parts: '2', steps: '0' } },
    { counts: { sessions: '2', parts: '1', steps: '2' } },
    { sessions: Array.from({ length: 1001 }, () => sessions[0]) }, { extra: true },
  ]) expect(NativeUsagePassPageSchema.safeParse({ ...page, ...patch }).success).toBe(false);
});

test('native owner acknowledgement preserves EOF and exact counts; admission is strict', () => {
  expect(NativeUsagePassAckSchema.safeParse(ack).success).toBe(true);
  expect(NativeUsagePassAckSchema.safeParse({ ...ack, nextCursor: 'next', eof: null }).success).toBe(true);
  for (const patch of [{ nextCursor: 'next' }, { eof: null }, { sourceWatermark: '-1' },
    { eof: { ...page.eof, counts: { ...counts, steps: '3' } } }, { extra: true }])
    expect(NativeUsagePassAckSchema.safeParse({ ...ack, ...patch }).success).toBe(false);
  expect(NativeUsagePassAdmissionSchema.safeParse({ identity, initialCursor: '', ownerReceiptId: 'receipt', sourceWatermark: '0' }).success).toBe(false);
});
