import { expect, test } from 'bun:test';
import { DevelopmentUsageRegistrationSchema, type DevelopmentNativePageCapture, type NativeUsagePassPage } from '@crewstation/contracts';
import { prepareDevelopmentNativePacket, type DevelopmentNativePacketInput } from './packet';

// RFC-034: a transport frame cannot lose or rewrite a row from its independently copied original page.
function fixture(count = 3, options: { start?: number; root?: boolean; final?: boolean; ordinal?: string; scanBefore?: string } = {}) {
  const executionId = Bun.randomUUIDv7(), start = options.start ?? 0;
  const registration = DevelopmentUsageRegistrationSchema.parse({ runtimeTaskId: executionId,
    key: { executionId, journalId: crypto.randomUUID(), incarnation: crypto.randomUUID(), payloadDigest: 'a'.repeat(64) },
    podUid: 'fixture-original-pod', profileId: Bun.randomUUIDv7(), profileRevision: 7,
    identity: { sourceKind: 'development-agent', projectId: Bun.randomUUIDv7(), taskId: Bun.randomUUIDv7(),
      agentId: Bun.randomUUIDv7(), executionId, executionGeneration: 1 } });
  const store = { state: 'observed' as const, sourceEpoch: crypto.randomUUID(), actualPathDigest: 'a'.repeat(64), fileIdentityDigest: 'b'.repeat(64) };
  const identity = { passId: 'fixture-pass', turn: 'fixture-turn', nativeSource: 'opencode:' + store.actualPathDigest,
    sourceGeneration: 'fixture-actual-generation', rootSessionId: 'fixture-root', lineageKey: 'fixture-lineage', epoch: store.sourceEpoch, phase: 'final' as const };
  const sessions = options.root === false ? [] : [{ id: 'fixture-root', parentSessionId: null }, { id: 'fixture-child', parentSessionId: 'fixture-root' }];
  const steps = Array.from({ length: count }, (_, i) => ({ id: 'fixture-child', parentSessionId: 'fixture-root', stepId: `fixture-step-${start + i}`,
    occurredAt: 1_790_000_000_000 + start + i, usage: { input: String(start + i + 1), cacheRead: '3', cacheWrite: '5', output: '2' },
    model: { provider: 'fixture-provider', id: 'fixture-model' } }));
  const counts = { sessions: options.root === false && count === 0 ? '0' : '2', parts: String(start + count), steps: String(start + count) };
  const scanBefore = options.scanBefore ?? String(start), scanned = sessions.length + count;
  const page: NativeUsagePassPage = { identity, ordinal: options.ordinal ?? '0', cursor: 'fixture-cursor',
    nextCursor: options.final === false ? 'fixture-next' : null, previousDigest: 'c'.repeat(64), payloadDigest: 'd'.repeat(64), cumulativeDigest: 'e'.repeat(64),
    scanPositionBefore: scanBefore, scanPositionAfter: String(BigInt(scanBefore) + BigInt(scanned)), scannedRawRows: String(scanned),
    counts, sessions, steps, issues: [], eof: options.final === false ? null : { fingerprint: 'f'.repeat(64), counts } };
  const packetCount = Math.max(1, Math.ceil(count / 100)), from = 11;
  const ack = { contract: 'native-usage-page-ack-v2' as const, identity, ownerReceiptId: 'fixture-owner', ordinal: page.ordinal,
    payloadDigest: page.payloadDigest, cumulativeDigest: page.cumulativeDigest, scanPositionAfter: page.scanPositionAfter,
    counts, nextCursor: page.nextCursor, sourceWatermark: String(from + packetCount - 1), eof: page.eof };
  const original = { version: 2 as const, key: registration.key, podUid: registration.podUid,
    preparation: { turn: identity.turn, turnIndex: 4, rootSessionId: identity.rootSessionId, observedAt: '2026-10-06T00:00:00.000Z', store },
    baselineKind: 'fresh' as const, rootCreatedAt: null, admission: { identity, initialCursor: 'fixture-initial', ownerReceiptId: ack.ownerReceiptId, sourceWatermark: '0' },
    ack, document: '\n' + JSON.stringify(page, null, 2) + '\n' };
  const inputs: DevelopmentNativePacketInput[] = Array.from({ length: packetCount }, (_, packetIndex) => ({ key: registration.key,
    registration, ownerRegistration: structuredClone(registration), selection: { version: 2, expectedNamespace: identity.lineageKey }, original,
    event: { sequence: from + packetIndex, occurredAt: '2026-10-06T00:00:01.000Z', capture: { version: 2, diagnostics: [],
      nativeSource: { version: 2, stage: 'page', turnIndex: 4, ack, sequenceFrom: from, sequenceThrough: from + packetCount - 1,
        sequence: from + packetIndex, packetIndex, packetCount }, measurements: steps.slice(packetIndex * 100, (packetIndex + 1) * 100) } } }));
  return { page, inputs };
}
function frame(input: DevelopmentNativePacketInput): DevelopmentNativePageCapture {
  if (input.event.capture.version !== 2) throw new Error('Fixture must retain v2');
  return input.event.capture;
}
function bindFollowingPage(next: ReturnType<typeof fixture>, previous: ReturnType<typeof fixture>): void {
  const first = previous.inputs[0]!;
  next.page.identity = structuredClone(first.original.ack.identity);
  next.page.previousDigest = previous.page.cumulativeDigest; next.page.cursor = previous.page.nextCursor!;
  const from = frame(previous.inputs.at(-1)!).nativeSource.sequenceThrough + 1;
  for (const [index, input] of next.inputs.entries()) {
    input.key = structuredClone(first.key); input.registration = structuredClone(first.registration);
    input.ownerRegistration = structuredClone(first.ownerRegistration);
    input.original.key = structuredClone(first.key); input.original.podUid = first.original.podUid;
    input.original.preparation = structuredClone(first.original.preparation);
    input.original.admission = structuredClone(first.original.admission);
    input.original.ack.identity = structuredClone(next.page.identity);
    input.original.ack.sourceWatermark = String(from + next.inputs.length - 1);
    input.original.document = JSON.stringify(next.page);
    const source = frame(input).nativeSource;
    source.ack = structuredClone(input.original.ack); source.sequenceFrom = from;
    source.sequenceThrough = from + next.inputs.length - 1; source.sequence = from + index;
    input.event.sequence = source.sequence;
  }
}
test('every original row and all four buckets survive 1201 steps across successive transport pages', () => {
  const first = fixture(998, { final: false }), second = fixture(203, { start: 998, root: false, ordinal: '1', scanBefore: '1000' });
  bindFollowingPage(second, first);
  const records = [...first.inputs, ...second.inputs].flatMap((input) => prepareDevelopmentNativePacket(input).measurements);
  expect(records).toEqual([...first.page.steps, ...second.page.steps]);
  expect(new Set(records.map((row) => row.stepId)).size).toBe(1201);
  expect(records.reduce((sum, row) => sum + BigInt(row.usage.input!), 0n)).toBe(721801n);
  expect(records.reduce((sum, row) => sum + BigInt(row.usage.cacheRead!), 0n)).toBe(3603n);
  expect(records.reduce((sum, row) => sum + BigInt(row.usage.cacheWrite!), 0n)).toBe(6005n);
  expect(records.reduce((sum, row) => sum + BigInt(row.usage.output!), 0n)).toBe(2402n);
  expect(prepareDevelopmentNativePacket(first.inputs[0]!).page.nextCursor).toBe('fixture-next');
});
test('packet boundaries use the original ordered 100-step slices, including the short last packet', () => {
  for (const count of [1, 99, 100, 101, 998, 1000]) {
    const source = fixture(count, { root: count === 1000 ? false : true });
    const prepared = source.inputs.map(prepareDevelopmentNativePacket);
    expect(prepared.flatMap((packet) => packet.measurements)).toEqual(source.page.steps);
    expect(prepared.map((packet) => packet.packetIndex)).toEqual(source.inputs.map((_, i) => i));
    expect(prepared.at(-1)!.measurements.length).toBe(count % 100 || 100);
  }
});
test('empty EOF and session-only pages retain an actual empty packet without declaring a zero baseline', () => {
  for (const root of [false, true]) {
    const source = fixture(0, { root });
    const result = prepareDevelopmentNativePacket(source.inputs[0]!);
    expect(result.packetCount).toBe(1); expect(result.measurements).toEqual([]);
    expect(result.page.sessions).toEqual(source.page.sessions);
    expect(result.original.rootCreatedAt).toBeNull(); expect(result.original.baselineKind).toBe('fresh');
    expect(result.original.document).toBe(source.inputs[0]!.original.document);
  }
});
test('unknown buckets, model and occurrence time stay unknown and arbitrary precision page identities remain exact', () => {
  const source = fixture(1, { ordinal: '100000000000000000000000', scanBefore: '999999999999999999999999' });
  const row = source.page.steps[0]!; row.usage.cacheWrite = null; row.model = null; row.occurredAt = null;
  source.inputs[0]!.original.document = JSON.stringify(source.page);
  const result = prepareDevelopmentNativePacket(source.inputs[0]!);
  expect(result.measurements).toEqual([row]); expect(result.page.ordinal).toBe('100000000000000000000000');
  expect(result.page.scanPositionAfter).toBe('1000000000000000000000002');
});
test('a rewritten, omitted, reordered or extra original measurement cannot be accepted', () => {
  const mutations: Array<(input: DevelopmentNativePacketInput) => void> = [
    (i) => { frame(i).measurements[0]!.usage.input = '999'; },
    (i) => { frame(i).measurements[0]!.usage.cacheRead = '999'; },
    (i) => { frame(i).measurements[0]!.usage.cacheWrite = '999'; },
    (i) => { frame(i).measurements[0]!.usage.output = null; },
    (i) => { frame(i).measurements[0]!.stepId = 'different'; },
    (i) => { frame(i).measurements[0]!.id = 'different-child'; },
    (i) => { frame(i).measurements[0]!.parentSessionId = 'different-parent'; },
    (i) => { frame(i).measurements[0]!.occurredAt = null; },
    (i) => { frame(i).measurements[0]!.model = { provider: 'different', id: 'different' }; },
    (i) => { frame(i).measurements.pop(); }, (i) => { frame(i).measurements.reverse(); },
    (i) => { frame(i).measurements.push({ ...frame(i).measurements[0]!, stepId: 'extra' }); },
  ];
  for (const mutate of mutations) {
    const input = structuredClone(fixture().inputs[0]!); mutate(input);
    expect(() => prepareDevelopmentNativePacket(input)).toThrow('全部字段');
  }
});
test('packet count and position must describe the actual original page instead of a caller-selected subset', () => {
  const input = structuredClone(fixture(101).inputs[0]!);
  frame(input).nativeSource.packetCount = 1; frame(input).nativeSource.sequenceThrough = 11;
  frame(input).nativeSource.ack.sourceWatermark = '11'; input.original.ack.sourceWatermark = '11';
  expect(() => prepareDevelopmentNativePacket(input)).toThrow('全部字段');
  const shifted = structuredClone(fixture(101).inputs[0]!);
  frame(shifted).nativeSource.packetIndex = 1; frame(shifted).nativeSource.sequence = 12; shifted.event.sequence = 12;
  expect(() => prepareDevelopmentNativePacket(shifted)).toThrow('全部字段');
});
test('an original page must match the independent owner, execution key, Pod and frozen native selection', () => {
  const mutations: Array<(input: DevelopmentNativePacketInput) => void> = [
    (i) => { i.ownerRegistration.profileRevision++; }, (i) => { i.ownerRegistration.profileId = Bun.randomUUIDv7(); },
    (i) => { i.ownerRegistration.podUid = 'other-pod'; }, (i) => { i.key = { ...i.key, incarnation: crypto.randomUUID() }; },
    (i) => { i.original = { ...i.original, key: { ...i.key, journalId: crypto.randomUUID() } }; },
    (i) => { i.original = { ...i.original, podUid: 'other-pod' }; },
    (i) => { i.selection = undefined; }, (i) => { i.selection!.version = 1; }, (i) => { i.selection!.expectedNamespace = ''; },
    (i) => { i.selection!.expectedNamespace = 'other-lineage'; },
    (i) => { frame(i).nativeSource.turnIndex++; }, (i) => { frame(i).nativeSource.ack.ownerReceiptId = 'other-owner'; },
  ];
  for (const mutate of mutations) {
    const input = structuredClone(fixture().inputs[0]!); mutate(input);
    expect(() => prepareDevelopmentNativePacket(input)).toThrow();
  }
});
test('strict original evidence rejects changed identities, metadata, document rows and invented fields', () => {
  const mutations: Array<(input: DevelopmentNativePacketInput) => void> = [
    (i) => { i.original.preparation.store.sourceEpoch = crypto.randomUUID(); },
    (i) => { i.original.ack.cumulativeDigest = '1'.repeat(64); },
    (i) => { i.original.document = '{}'; }, (i) => { i.original.document = 'not JSON'; },
    (i) => { i.original.document = JSON.stringify({ ...JSON.parse(i.original.document), extra: true }); },
    (i) => { i.original.document = JSON.stringify({ ...JSON.parse(i.original.document), steps: [] }); },
    (i) => { i.original.admission.identity.sourceGeneration = 'other-generation'; },
  ];
  for (const mutate of mutations) {
    const input = structuredClone(fixture().inputs[0]!); mutate(input);
    expect(() => prepareDevelopmentNativePacket(input)).toThrow();
  }
});
test('replay fingerprints preserve exact original document bytes, frame diagnostics and sequence', () => {
  const input = fixture().inputs[0]!, first = prepareDevelopmentNativePacket(input);
  expect(prepareDevelopmentNativePacket(structuredClone(input)).fingerprint).toBe(first.fingerprint);
  const changed = structuredClone(input); changed.original.document = JSON.stringify(JSON.parse(changed.original.document));
  expect(prepareDevelopmentNativePacket(changed).fingerprint).not.toBe(first.fingerprint);
  const diagnostic = structuredClone(input); frame(diagnostic).diagnostics = ['fixture-pending-evidence'];
  expect(prepareDevelopmentNativePacket(diagnostic).fingerprint).not.toBe(first.fingerprint);
});
