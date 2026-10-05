import { expect, test } from 'bun:test';
import { createBuildKitControlClient } from './control';
import { buildKitHistory, buildKitUsage, buildKitVersion } from './controlRecords';
import { protoBoolean, protoBytes, protoFields, protoInteger, protoMessage, protoText, protoTimestamp } from './protobuf';
import type { BuildKitControlMethod } from './controlTransport';

const own = '8irdm36x5aeaig4ys10bximdo', foreign = 'mwaxkqkfmwy3a652pw34tjg5l', worker = 's4agj5nk6vy5bxmlc1gdws62k';
const digest = 'sha256:' + 'a'.repeat(64), revision = 'b'.repeat(40);
const timestamp = protoMessage([{ number: 1, value: 1_790_784_077n }, { number: 2, value: 263_787_585n }]);
const version = protoMessage([{ number: 1, value: 'github.com/moby/buildkit' }, { number: 2, value: 'v0.33.0' }, { number: 3, value: revision }]);
function usage(extra: Parameters<typeof protoMessage>[0] = []) {
  return protoMessage([{ number: 1, value: own }, { number: 4, value: 120n }, { number: 6, value: timestamp },
    { number: 7, value: timestamp }, { number: 8, value: 2n }, { number: 9, value: 'private command and credentials' },
    { number: 10, value: 'regular' }, { number: 12, value: foreign }, ...extra]);
}
const descriptor = protoMessage([{ number: 1, value: 'application/vnd.oci.image.manifest.v1+json' }, { number: 2, value: digest }, { number: 3, value: 12n },
  { number: 5, value: protoMessage([{ number: 1, value: 'private-name' }, { number: 2, value: 'private annotations' }]) }]);
function history(event = 1n, extra: Parameters<typeof protoMessage>[0] = []) {
  const outputs = protoMessage([{ number: 1, value: descriptor }, { number: 2, value: descriptor },
    { number: 3, value: protoMessage([{ number: 1, value: 0n }, { number: 2, value: descriptor }]) }]);
  const privateEntry = protoMessage([{ number: 1, value: 'private-name' }, { number: 2, value: 'private credentials' }]);
  const body = protoMessage([{ number: 1, value: own }, { number: 3, value: privateEntry }, { number: 4, value: protoMessage([{ number: 1, value: 'image' }, { number: 2, value: privateEntry }]) },
    { number: 6, value: timestamp }, { number: 7, value: timestamp }, { number: 8, value: descriptor }, { number: 9, value: privateEntry },
    { number: 10, value: outputs }, { number: 11, value: protoMessage([{ number: 1, value: 'linux/arm64' }, { number: 2, value: outputs }]) },
    { number: 12, value: 2n }, { number: 13, value: descriptor }, ...extra]);
  return protoMessage([{ number: 1, value: event }, { number: 2, value: body }]);
}
test('pinned native wire reader preserves exact birth nanoseconds and every safe cache field without leaking private descriptions', () => {
  const result = buildKitUsage(usage());
  expect(result).toEqual({ id: own, mutable: false, inUse: false, size: 120, createdAt: '2026-09-30T16:01:17.263787585Z',
    lastUsedAt: '2026-09-30T16:01:17.263787585Z', usageCount: 2, recordType: 'regular', shared: false, parents: [foreign] });
  expect(JSON.stringify(result)).not.toContain('private');
  expect(buildKitUsage(usage([{ number: 2, value: 1n }, { number: 3, value: 1n }, { number: 11, value: 1n }, { number: 5, value: foreign }]))).toMatchObject({ mutable: true, inUse: true, shared: true, parents: [foreign] });
  expect(buildKitVersion(version)).toEqual({ version: 'v0.33.0', package: 'github.com/moby/buildkit', revision });
});
test('complete native history retains one-way birth digest and all descriptors while private maps stay outside the result', () => {
  const result = buildKitHistory(history());
  expect(result).toMatchObject({ ref: own, event: 'complete', pinned: false, generation: 2, failed: false, completedAt: '2026-09-30T16:01:17.263787585Z' });
  expect(result.descriptors).toEqual([{ digest, size: 12, mediaType: 'application/vnd.oci.image.manifest.v1+json' }]);
  expect(result.nativeIdentity).toMatch(/^[a-f0-9]{64}$/); expect(JSON.stringify(result)).not.toContain('private');
  expect(buildKitHistory(history(0n))).toMatchObject({ event: 'started' });
  expect(buildKitHistory(history(2n, [{ number: 14, value: 1n }, { number: 5, value: new Uint8Array() }, { number: 18, value: descriptor }]))).toMatchObject({ event: 'deleted', pinned: true, failed: true });
});
test('full read API uses no filters or history limits, requires successful unary shape, and retains exact worker version', async () => {
  const requests: Array<{ method: BuildKitControlMethod; fields: ReturnType<typeof protoFields> }> = [];
  const client = createBuildKitControlClient(async (method, body) => {
    requests.push({ method, fields: protoFields(body) });
    if (method === 'Info') return [protoMessage([{ number: 1, value: version }])];
    if (method === 'ListWorkers') return [protoMessage([{ number: 1, value: protoMessage([{ number: 1, value: worker }, { number: 5, value: version }]) }])];
    if (method === 'DiskUsage') return [protoMessage([{ number: 1, value: usage() }])];
    return [history()];
  });
  expect(await client.info()).toMatchObject({ version: 'v0.33.0', revision });
  expect(await client.workers()).toEqual([{ id: worker, version: 'v0.33.0', package: 'github.com/moby/buildkit', revision }]);
  expect(await client.diskUsage()).toHaveLength(1); expect(await client.history()).toHaveLength(1);
  expect(requests.slice(0, 3).map(row => row.fields)).toEqual([[], [], []]);
  expect(requests[3]).toEqual({ method: 'ListenBuildHistory', fields: [{ number: 3, wire: 0, value: 1n }] });
  const empty = createBuildKitControlClient(async () => [new Uint8Array()]); expect(await empty.diskUsage()).toEqual([]);
  const noHistory = createBuildKitControlClient(async () => []); expect(await noHistory.history()).toEqual([]);
});
test('repeated cache, worker or history identities and deleted history during EOF cannot claim complete native scope', async () => {
  const records = protoMessage([{ number: 1, value: usage() }, { number: 1, value: usage() }]);
  await expect(createBuildKitControlClient(async () => [records]).diskUsage()).rejects.toThrow('repeated');
  await expect(createBuildKitControlClient(async () => [history(), history()]).history()).rejects.toThrow('changed');
  await expect(createBuildKitControlClient(async () => [history(2n)]).history()).rejects.toThrow('changed');
  const workerRecord = protoMessage([{ number: 1, value: worker }, { number: 5, value: version }]);
  await expect(createBuildKitControlClient(async () => [protoMessage([{ number: 1, value: workerRecord }, { number: 1, value: workerRecord }])]).workers()).rejects.toThrow('repeated');
  await expect(createBuildKitControlClient(async () => [new Uint8Array()]).workers()).rejects.toThrow('empty');
  await expect(createBuildKitControlClient(async () => []).info()).rejects.toThrow('incomplete');
  await expect(createBuildKitControlClient(async () => [new Uint8Array(), new Uint8Array()]).diskUsage()).rejects.toThrow('repeated');
});
test('truncated, noncanonical, group and overflow wire data and repeated singular fields fail before publication', () => {
  for (const bytes of [[0], [8, 128], [8, 128, 0], [8, ...Array(10).fill(255)], [10, 3, 1], [11], [9, 1], [13, 1]]) {
    expect(() => protoFields(Uint8Array.from(bytes))).toThrow();
  }
  expect(() => protoFields(new Uint8Array(8_388_609))).toThrow('budget');
  const unknown = protoFields(Buffer.concat([Buffer.from([9]), Buffer.alloc(8), Buffer.from([21]), Buffer.alloc(4)]));
  expect(unknown.map(row => row.wire)).toEqual([1, 5]);
  const fields = protoFields(protoMessage([{ number: 1, value: own }, { number: 2, value: 2n }, { number: 3, value: 0xffffffffffffffffn }]));
  expect(protoText(fields, 1)).toBe(own); expect(protoBytes(fields, 4)).toBeUndefined(); expect(protoInteger(fields, 4, 3)).toBe(3);
  expect(protoBoolean(fields, 4)).toBe(false); expect(protoTimestamp(undefined)).toBeUndefined();
  expect(() => protoBoolean(fields, 2)).toThrow('boolean'); expect(() => protoInteger(fields, 3)).toThrow('exactly');
  expect(() => protoText(protoFields(Buffer.from([10, 1, 255])), 1)).toThrow();
  expect(() => protoText(fields, 4, true)).toThrow('missing'); expect(() => protoText(fields, 2)).toThrow('wire');
  expect(() => buildKitUsage(usage([{ number: 1, value: foreign }]))).toThrow('repeated');
  expect(() => buildKitUsage(usage([{ number: 12, value: 1n }]))).toThrow('wire');
  expect(() => protoTimestamp(protoMessage([{ number: 2, value: 1_000_000_000n }]))).toThrow('timestamp');
  expect(() => protoMessage([{ number: 0, value: 1n }])).toThrow('field'); expect(() => protoMessage([{ number: 1, value: -1n }])).toThrow('integer');
  expect(() => protoMessage([{ number: 1, value: new Uint8Array(8_388_609) }])).toThrow('budget');
});
test('unsupported versions and incomplete history or descriptor shapes are rejected without decoding their private payload', () => {
  expect(() => buildKitVersion(protoMessage([{ number: 1, value: 'github.com/moby/buildkit' }, { number: 2, value: 'v0.32.0' }, { number: 3, value: revision }]))).toThrow('unsupported');
  expect(() => buildKitHistory(history(3n))).toThrow('unsupported');
  expect(() => buildKitHistory(protoMessage([{ number: 1, value: 1n }, { number: 2, value: protoMessage([{ number: 1, value: own }, { number: 6, value: timestamp }]) }]))).toThrow('terminal');
  const invalid = protoMessage([{ number: 1, value: own }, { number: 6, value: timestamp }, { number: 7, value: timestamp }, { number: 10, value: protoMessage([{ number: 3, value: 1n }]) }]);
  expect(() => buildKitHistory(protoMessage([{ number: 1, value: 1n }, { number: 2, value: invalid }]))).toThrow('wire');
  expect(() => buildKitUsage(protoMessage([{ number: 1, value: own }]))).toThrow('missing');
});
