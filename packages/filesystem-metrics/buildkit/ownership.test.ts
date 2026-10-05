import { expect, test } from 'bun:test';
import { boltSnapshotFixture } from './fixture';
import type { BoltFixtureField } from './fixture';
import { buildKitCacheOwnership } from './ownership';
import type { BuildKitOwnershipRequest } from './ownership';

const worker = 'w'.repeat(25), own = 'a'.repeat(25), foreign = 'b'.repeat(25), base = 'c'.repeat(25), context = 'd'.repeat(25), mutable = 'e'.repeat(25), frontend = 'f'.repeat(25), frontendAlias = 'g'.repeat(25);
const layer = 'sha256:' + '1'.repeat(64), foreignLayer = 'sha256:' + '2'.repeat(64), baseLayer = 'sha256:' + '3'.repeat(64), op = 'sha256:' + '4'.repeat(64);
const at = '2026-09-30T16:01:17.263787585Z', ns = '1790784077263787585', oldNs = '1789121110952203835', birth = '010000000ee24f294d1038f2cbffff';
const field = (key: string, value: unknown): BoltFixtureField => ({ key, value: Buffer.from(JSON.stringify({ value })) });
function fixture(includeFrontend = false) {
  const records: BoltFixtureField[] = [
    { key: base, value: [field('cache.blob', baseLayer)] },
    { key: own, value: [field('cache.blob', layer), field('cache.parent', base)] },
    { key: foreign, value: [field('cache.blob', foreignLayer), field('cache.parent', base)] },
    { key: context, value: [field('cache.equalMutable', mutable)] },
    { key: mutable, value: [field('cache.recordType', 'source.local'), field('local.sharedKey', 'context:original-native-shared-key:')] },
    ...(includeFrontend ? [{ key: frontend, value: [field('cache.recordType', 'source.local'), field('local.sharedKey', 'dockerfile:original-native-shared-key:')] },
      { key: frontendAlias, value: [field('cache.equalMutable', frontend)] }] : []),
  ];
  for (const record of records) (record.value as BoltFixtureField[]).push({ key: 'cache.createdAt', value: Buffer.from('{"value":' + (record.key === frontend ? oldNs : ns) + '}') }, { key: 'cache.lastUsedAt', value: Buffer.from('{"value":' + ns + '}') });
  const graph = [[base, [own, foreign]], [context, [own]], [own, []], [foreign, []]] as Array<[string, string[]]>;
  const zero = Buffer.alloc(0), ids = [base, own, foreign, context];
  const result = boltSnapshotFixture([
    { key: '_links', value: graph.map(([key, targets]) => ({ key, value: targets.map(target => ({ key: JSON.stringify({ Digest: op, Input: 0 }) + '@' + target, value: zero })) })) },
    { key: '_result', value: ids.map(key => ({ key, value: [{ key: worker + '::' + key, value: Buffer.from(JSON.stringify({ ID: worker + '::' + key, CreatedAt: at })) }] })) },
    { key: '_byresult', value: ids.map(key => ({ key: worker + '::' + key, value: [{ key, value: zero }] })) },
    { key: '_backlinks', value: ids.map(key => ({ key, value: graph.filter(([, targets]) => targets.includes(key)).map(([parent]) => ({ key: parent, value: zero })) })) },
  ]);
  const nativeSnapshot = (key: string, storageId: number, parent?: string): BoltFixtureField => ({ key, value: [{ key: 'id', value: Buffer.from(storageId > 127 ? [storageId & 127 | 128, storageId >> 7] : [storageId]) },
    { key: 'kind', value: Buffer.from([3]) }, { key: 'createdat', value: Buffer.from(birth, 'hex') }, ...(parent ? [{ key: 'parent', value: Buffer.from(parent) }] : [])] });
  const baseKey = 'buildkit/2/' + base;
  const snapshots = [nativeSnapshot(baseKey, 1), nativeSnapshot('buildkit/196/' + own, 134, baseKey), nativeSnapshot('buildkit/3/' + foreign, 9, baseKey), nativeSnapshot('buildkit/4/' + mutable, 4),
    ...(includeFrontend ? [nativeSnapshot('buildkit/5/' + frontend, 5)] : [])];
  const bytes = { cache: boltSnapshotFixture([{ key: '_main', value: records }]), results: result,
    snapshots: boltSnapshotFixture([{ key: 'v1', value: [{ key: 'snapshots', value: snapshots }, { key: 'parents', value: [] }] }]) };
  const request: BuildKitOwnershipRequest = { workerId: worker, projectLayers: [layer], foreignLayers: [foreignLayer, baseLayer], foreignResultKeys: [foreign],
    buildWindows: [{ started: '2026-09-30T16:01:15Z', finished: '2026-09-30T16:01:18Z' }], platformInputs: [] };
  return { bytes, request, records };
}
test('own result ancestry includes its mutable local source, preserves foreign layers, and pins physical storage 134 rather than lease 196', () => {
  const f = fixture(), graph = buildKitCacheOwnership(f.request, f.bytes);
  expect(graph.complete).toBe(true); expect(graph.exclusive.map(row => row.id).sort()).toEqual([own, context, mutable].sort());
  expect(graph.shared).toEqual([base]); expect(graph.physical.map(row => row.storageId).sort()).toEqual(['134', '4']);
  expect(graph.physicalReclamationProven).toBe(false); expect(graph.unknown).toEqual([]);
  expect(buildKitCacheOwnership(JSON.parse(JSON.stringify(f.request)), f.bytes).identity).toBe(graph.identity);
});
test('a foreign result using the same input protects both immutable and mutable aliases', () => {
  const f = fixture(); f.request.foreignResultKeys.push(context);
  const graph = buildKitCacheOwnership(f.request, f.bytes);
  expect(graph.exclusive.map(row => row.id)).toEqual([own]); expect(graph.shared).toEqual([base, context, mutable].sort());
  expect(graph.physical.map(row => row.storageId)).toEqual(['134']);
});
test('old frontend input reused by this build remains unknown until all its files match an independent platform template', () => {
  const f = fixture(true); expect(buildKitCacheOwnership(f.request, f.bytes)).toMatchObject({ complete: false, unknown: [frontend, frontendAlias] });
  const file = { path: 'Dockerfile', digest: 'sha256:' + '8'.repeat(64) };
  f.request.platformInputs.push({ snapshotKey: 'buildkit/5/' + frontend, storageId: '5', created: birth, sourceIdentity: '9'.repeat(64), files: [{ ...file, kind: 'file' }], templateFiles: [file] });
  expect(buildKitCacheOwnership(f.request, f.bytes)).toMatchObject({ complete: true, unknown: [] });
  for (const change of [{ storageId: '196' }, { created: '010000000ee24f294d1038f2caffff' }, { files: [{ ...file, kind: 'file' as const, digest: layer }] }, { files: [{ path: 'Dockerfile', kind: 'symlink' as const }] }, { files: [{ ...file, kind: 'file' as const }, { path: 'private-source', kind: 'file' as const, digest: layer }] }]) {
    const request = structuredClone(f.request); Object.assign(request.platformInputs[0]!, change); expect(() => buildKitCacheOwnership(request, f.bytes)).toThrow();
  }
});
test('wrong workers, missing foreign roots, inverted windows and unbound request fields are rejected', () => {
  const f = fixture();
  for (const changes of [{ workerId: 'x'.repeat(25) }, { foreignResultKeys: ['unknown'] }, { buildWindows: [{ started: '2026-09-30T16:01:18Z', finished: '2026-09-30T16:01:15Z' }] }, { force: true }]) expect(() => buildKitCacheOwnership({ ...f.request, ...changes }, f.bytes)).toThrow();
});
