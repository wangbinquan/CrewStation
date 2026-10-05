import { describe, expect, test } from 'bun:test';
import { boltChecksum, openBoltSnapshot } from './boltSnapshot';
import { boltCacheFixture } from './fixture';
import { readBuildKitCacheMetadata } from './metadata';

const first = 'a'.repeat(25), second = 'b'.repeat(25), blob = 'sha256:' + 'c'.repeat(64);
const row = (id = first, birth = '1790784077263787585') => ({ id, fields: {
  'cache.createdAt': '{"value":' + birth + '}', 'cache.snapshot': JSON.stringify({ value: id }),
  'cache.blob': JSON.stringify({ value: blob }), 'cache.description': '{"value":"private command do-not-expose"}',
} as Record<string, string | null> });

describe('native BuildKit bbolt cache identity reader', () => {
  test('actual page and nested bucket decoding retains distinct nanosecond births and no private descriptions', () => {
    const next = row(second, '1790784077263787586'); next.fields['cache.parent'] = JSON.stringify({ value: first });
    for (const branch of [false, true]) {
      const source = readBuildKitCacheMetadata(boltCacheFixture([next, row()], branch));
      expect(source.complete).toBe(true); expect(source.records).toHaveLength(2);
      expect(source.records[0]).toEqual({ id: first, snapshot: first, createdNanoseconds: '1790784077263787585', recordType: 'regular', parents: [], blob });
      expect(source.records[1]!.createdNanoseconds).toBe('1790784077263787586'); expect(source.records[1]!.parents).toEqual([first]);
      expect(JSON.stringify(source)).not.toContain('do-not-expose');
    }
  });
  test('native nil optional tombstones and legacy snapshot fallback are supported; native digest snapshot keys remain exact', () => {
    const old = row(); old.fields['cache.snapshot'] = null; old.fields['cache.blob'] = null;
    expect(readBuildKitCacheMetadata(boltCacheFixture([old])).records[0]!.snapshot).toBe(first);
    expect(readBuildKitCacheMetadata(boltCacheFixture([old])).records[0]!.blob).toBeUndefined();
    old.fields['cache.snapshot'] = JSON.stringify({ value: blob });
    expect(readBuildKitCacheMetadata(boltCacheFixture([old])).records[0]!.snapshot).toBe(blob);
    old.fields['cache.createdAt'] = null;
    expect(() => readBuildKitCacheMetadata(boltCacheFixture([old]))).toThrow('cache birth is missing');
  });
  test('one failed meta checksum can use the other original meta; two failures, truncation and cycles fail closed', () => {
    const raw = boltCacheFixture([row()], true); raw[72] = raw[72]! ^ 1;
    expect(readBuildKitCacheMetadata(raw).records).toHaveLength(1); raw[4096 + 72] = raw[4096 + 72]! ^ 1;
    expect(() => readBuildKitCacheMetadata(raw)).toThrow('meta snapshot is incomplete');
    expect(() => readBuildKitCacheMetadata(boltCacheFixture([row()]).subarray(0, 8192))).toThrow('meta snapshot is incomplete');
    const cycle = boltCacheFixture([row()], true); cycle.writeBigUInt64LE(2n, 8192 + 24);
    expect(() => readBuildKitCacheMetadata(cycle)).toThrow('page is missing or repeated');
    const duplicate = boltCacheFixture([row()], true); duplicate.writeBigUInt64LE(3n, 8192 + 40);
    expect(() => readBuildKitCacheMetadata(duplicate)).toThrow('page is missing or repeated');
  });
  test('unknown record layouts, missing parents, duplicate keys and rounded or missing births cannot become an empty graph', () => {
    const original = row(); original.fields['cache.parent'] = JSON.stringify({ value: second });
    expect(() => readBuildKitCacheMetadata(boltCacheFixture([original]))).toThrow('parent graph is incomplete');
    expect(() => readBuildKitCacheMetadata(boltCacheFixture([row(), row()]))).toThrow('keys are duplicated');
    expect(() => readBuildKitCacheMetadata(boltCacheFixture([row(first, '1.7907840772637876e18')]))).toThrow('cache birth is missing');
    expect(() => readBuildKitCacheMetadata(boltCacheFixture([{ ...row(), id: '../cache' }]))).toThrow('record layout is unsupported');
    const bad = boltCacheFixture([row()]); bad.writeUInt32LE(99, 8192 + 16);
    expect(() => readBuildKitCacheMetadata(bad)).toThrow('leaf flags are unsupported');
  });
  test('a snapshot index supports repeated reads without reinterpreting caller-modified buffer views', () => {
    const raw = boltCacheFixture([row()]), original = Buffer.from(raw), reader = openBoltSnapshot(raw);
    raw.fill(0); const firstRead = reader.readBucket(['_main', first]); firstRead.get('cache.createdAt')!.value.fill(0);
    expect(reader.readBucket(['_main', first]).get('cache.createdAt')!.value.toString()).toBe('{"value":1790784077263787585}');
    expect(() => reader.readBucket(['missing'])).toThrow('bucket was not found');
    expect(boltChecksum(original.subarray(16, 72))).toBe(original.readBigUInt64LE(72));
  });
});
