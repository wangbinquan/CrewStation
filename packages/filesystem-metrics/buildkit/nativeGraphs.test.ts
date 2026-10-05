import { expect, test } from 'bun:test';
import { boltSnapshotFixture } from './fixture';
import type { BoltFixtureField } from './fixture';
import { readBuildKitResultCache } from './resultCache';
import { readBuildKitSnapshotMetadata } from './snapshots';

const own = 'a'.repeat(25), foreign = 'b'.repeat(25), worker = 'c'.repeat(25), source = 'sha256:' + 'd'.repeat(64), op = 'sha256:' + 'e'.repeat(64);
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value)), zero = Buffer.alloc(0);
function resultFields(): BoltFixtureField[] {
  const link = (target: string) => ({ key: JSON.stringify({ Digest: op, Input: 1 }) + '@' + target, value: zero });
  const result = (id: string) => ({ key: worker + '::' + id, value: bytes({ ID: worker + '::' + id, CreatedAt: '2026-09-30T16:01:17.268680502Z' }) });
  return [
    { key: '_links', value: [{ key: source, value: [link(own), link(foreign)] }, { key: own, value: [] }, { key: foreign, value: [] }] },
    { key: '_result', value: [{ key: own, value: [result(own)] }, { key: foreign, value: [result(foreign)] }] },
    { key: '_byresult', value: [{ key: worker + '::' + own, value: [{ key: own, value: zero }] }, { key: worker + '::' + foreign, value: [{ key: foreign, value: zero }] }] },
    { key: '_backlinks', value: [{ key: own, value: [{ key: source, value: zero }] }, { key: foreign, value: [{ key: source, value: zero }] }] },
  ];
}
const field = (fields: BoltFixtureField[], name: string) => fields.find(row => row.key === name)!.value as BoltFixtureField[];
test('native result graph retains all current results and both reverse indexes, including shared input branches', () => {
  const graph = readBuildKitResultCache(boltSnapshotFixture(resultFields()));
  expect(graph).toMatchObject({ complete: true, version: 'buildkit/0.33.0' });
  expect(graph.results).toHaveLength(2); expect(graph.links).toHaveLength(2);
  expect(graph.results).toContainEqual({ key: own, workerId: worker, cacheId: own, createdAt: '2026-09-30T16:01:17.268680502Z' });
  expect(graph.links).toContainEqual({ source, target: foreign, input: 1, output: 0, digest: op });
});
test('missing reverse indexes, substituted result identities and omitted link targets cannot become complete', () => {
  const missing = resultFields(); field(missing, '_byresult').pop();
  expect(() => readBuildKitResultCache(boltSnapshotFixture(missing))).toThrow('omitted');
  const backlink = resultFields(); field(field(backlink, '_backlinks'), own).pop();
  expect(() => readBuildKitResultCache(boltSnapshotFixture(backlink))).toThrow('incomplete');
  const replaced = resultFields(); field(field(replaced, '_result'), own)[0]!.value = bytes({ ID: worker + '::' + foreign, CreatedAt: '2026-09-30T16:01:17Z' });
  expect(() => readBuildKitResultCache(boltSnapshotFixture(replaced))).toThrow('differs');
  const target = resultFields(); field(target, '_links').splice(1, 1); field(target, '_result').splice(0, 1); field(target, '_byresult').splice(0, 1);
  expect(() => readBuildKitResultCache(boltSnapshotFixture(target))).toThrow('dependency graph is incomplete');
});
test('an unknown or private result payload and populated link values are unsupported, never silently omitted', () => {
  const privateRow = resultFields(); field(field(privateRow, '_result'), own)[0]!.value = bytes({ ID: worker + '::' + own, CreatedAt: '2026-09-30T16:01:17Z', command: 'private' });
  expect(() => readBuildKitResultCache(boltSnapshotFixture(privateRow))).toThrow();
  const populated = resultFields(); field(field(populated, '_links'), source)[0]!.value = bytes('unknown');
  expect(() => readBuildKitResultCache(boltSnapshotFixture(populated))).toThrow('layout is unsupported');
});

const parent = 'buildkit/2/' + foreign, child = 'buildkit/196/' + own, created = Buffer.from('010000000ee24f294d1038f2cbffff', 'hex');
function snapshotFields(): BoltFixtureField[] {
  const record = (id: Buffer, originalParent?: string) => [{ key: 'id', value: id }, { key: 'kind', value: Buffer.from([3]) }, { key: 'createdat', value: created },
    ...(originalParent ? [{ key: 'parent', value: Buffer.from(originalParent) }] : [])];
  return [{ key: 'v1', value: [{ key: 'snapshots', value: [{ key: parent, value: record(Buffer.from([1])) }, { key: child, value: record(Buffer.from([0x86, 1]), parent) }] }, { key: 'parents', value: [] }] }];
}
test('native physical snapshot storage ID is distinct from its namespaced lease sequence and retains its original birth', () => {
  const graph = readBuildKitSnapshotMetadata(boltSnapshotFixture(snapshotFields()));
  expect(graph.complete).toBe(true); expect(graph.records).toHaveLength(2);
  expect(graph.records.find(row => row.key === child)).toEqual({ key: child, snapshot: own, storageId: '134', kind: 3, created: created.toString('hex'), parent });
});
test('noncanonical, overflowed or truncated uint64 IDs and missing physical parents fail closed', () => {
  for (const invalid of [[0x81, 0], [0x80], Array(10).fill(0xff), [1, 0]]) {
    const fields = snapshotFields(); field(field(field(fields, 'v1'), 'snapshots'), child).find(row => row.key === 'id')!.value = Buffer.from(invalid);
    expect(() => readBuildKitSnapshotMetadata(boltSnapshotFixture(fields))).toThrow('storage ID');
  }
  const missing = snapshotFields(); field(field(missing, 'v1'), 'snapshots').pop();
  const rows = field(field(missing, 'v1'), 'snapshots'); rows[0]!.key = child;
  (rows[0]!.value as BoltFixtureField[]).push({ key: 'parent', value: Buffer.from(parent) });
  expect(() => readBuildKitSnapshotMetadata(boltSnapshotFixture(missing))).toThrow('graph is incomplete');
  const alias = snapshotFields(); field(field(field(alias, 'v1'), 'snapshots'), child).find(row => row.key === 'id')!.value = Buffer.from([1]);
  expect(() => readBuildKitSnapshotMetadata(boltSnapshotFixture(alias))).toThrow('aliases storage');
});
