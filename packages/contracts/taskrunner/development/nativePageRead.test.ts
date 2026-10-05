import { expect, test } from 'bun:test';
import { DEVELOPMENT_NATIVE_PAGE_CHUNK_BYTES, DevelopmentNativePageChunkSchema } from '../developmentUsage';
import { RunnerCommandSchema } from '../protocol';

const counts = { sessions: '1', parts: '0', steps: '0' };
const store = { state: 'observed' as const, sourceEpoch: crypto.randomUUID(), actualPathDigest: 'a'.repeat(64), fileIdentityDigest: 'b'.repeat(64) };
const identity = { passId: 'original-pass', turn: 'original-turn', nativeSource: 'opencode:' + store.actualPathDigest,
  sourceGeneration: 'actual-store', rootSessionId: 'root', lineageKey: 'original-lineage', epoch: store.sourceEpoch, phase: 'final' as const };
function packet() {
  return { version: 2 as const, key: { executionId: '019f0000-0000-7000-8000-000000000003', journalId: crypto.randomUUID(), incarnation: crypto.randomUUID(), payloadDigest: 'c'.repeat(64) },
    podUid: 'original-pod', preparation: { turn: identity.turn, turnIndex: 0, rootSessionId: identity.rootSessionId, observedAt: '2026-10-05T00:00:00.000Z', store },
    baselineKind: 'fresh' as const, rootCreatedAt: null,
    admission: { identity, initialCursor: 'original-initial-cursor', ownerReceiptId: 'original-owner', sourceWatermark: '0' },
    ack: { contract: 'native-usage-page-ack-v2' as const, identity, ownerReceiptId: 'original-owner', ordinal: '0', payloadDigest: 'd'.repeat(64), cumulativeDigest: 'e'.repeat(64), scanPositionAfter: '1', counts, nextCursor: null, sourceWatermark: '1', eof: { fingerprint: 'f'.repeat(64), counts } },
    document: { digest: 'a'.repeat(64), afterByte: 0, throughByte: 2, totalBytes: 2, chunk: btoa('{}'), eof: true },
  };
}
test('original-page transport is an explicit strict v2 reply; unknown root birth stays null', () => {
  const original = packet(); expect(DevelopmentNativePageChunkSchema.parse(original)).toEqual(original);
  for (const changed of [{ ...original, version: 1 }, { ...original, extra: true }, { ...original, key: { ...original.key, path: '/different' } }, { ...original, rootCreatedAt: -1 }, { ...original, rootCreatedAt: 253402300800000 }])
    expect(DevelopmentNativePageChunkSchema.safeParse(changed).success).toBe(false);
});
test('byte ranges cannot skip, truncate, forge EOF or carry a noncanonical base64 packet', () => {
  const original = packet();
  for (const document of [{ ...original.document, throughByte: 1 }, { ...original.document, afterByte: 1 },
    { ...original.document, totalBytes: 3 }, { ...original.document, eof: false }, { ...original.document, chunk: 'Zh==' },
    { ...original.document, chunk: '', throughByte: 0 }, { ...original.document, path: 'extra' }])
    expect(DevelopmentNativePageChunkSchema.safeParse({ ...original, document }).success).toBe(false);
  const bytes = 'x'.repeat(DEVELOPMENT_NATIVE_PAGE_CHUNK_BYTES);
  expect(DevelopmentNativePageChunkSchema.safeParse({ ...original, document: { ...original.document, chunk: btoa(bytes), throughByte: bytes.length, totalBytes: 10_000_000_000, eof: false } }).success).toBe(true);
  expect(DevelopmentNativePageChunkSchema.safeParse({ ...original, document: { ...original.document, chunk: btoa(bytes + 'x'), throughByte: bytes.length + 1, totalBytes: 10_000_000_000, eof: false } }).success).toBe(false);
});
test('preparation and frozen owner ACK must describe the same original pass', () => {
  const original = packet();
  for (const changed of [{ ...original, ack: { ...original.ack, ownerReceiptId: 'different' } },
    { ...original, ack: { ...original.ack, identity: { ...identity, sourceGeneration: 'different' } } },
    { ...original, preparation: { ...original.preparation, rootSessionId: 'different' } },
    { ...original, preparation: { ...original.preparation, store: { ...store, sourceEpoch: crypto.randomUUID() } } }])
    expect(DevelopmentNativePageChunkSchema.safeParse(changed).success).toBe(false);
});
test('read command binds the complete original key, pass, canonical ordinal and byte offset', () => {
  const command = { id: 'read', type: 'readDevelopmentNativePage' as const, key: packet().key, passId: identity.passId, ordinal: '100000000000000000000000' };
  expect(RunnerCommandSchema.parse(command)).toEqual({ ...command, afterByte: 0 });
  for (const changed of [{ ...command, ordinal: '01' }, { ...command, ordinal: '-1' }, { ...command, afterByte: -1 }, { ...command, afterByte: 0.5 }, { ...command, afterByte: Number.MAX_SAFE_INTEGER + 1 }, { ...command, limit: 100 }])
    expect(RunnerCommandSchema.safeParse(changed).success).toBe(false);
});
