import { expect, test } from 'bun:test';
import { buildKitFilesFixture, cacheId, blobDigest, workerId } from '../inventory/fixture';
import { observeBuildKitInventory } from '../inventory/inventory';
import { buildKitCacheGraphOwnership } from '../ownership';
import { qualifyBuildKitProjectInputs } from './projectInputs';
import type { BuildKitHistory } from '../controlRecords';
import type { createBuildKitInputClient } from './transport';

const mutable = 'd'.repeat(25), alias = 'e'.repeat(25), foreign = 'f'.repeat(25), foreignBlob = 'sha256:' + '9'.repeat(64);
const created = '1790784077218447085', lastUsed = '1790784077399201835';
const own: BuildKitHistory = { ref: 'g'.repeat(25), event: 'complete', createdAt: '2026-09-30T16:01:15.635953542Z', completedAt: '2026-09-30T16:01:17.375767127Z', pinned: false, generation: 1, failed: false, descriptors: [], nativeIdentity: '1'.repeat(64) };
const expected = [{ repositoryIdentity: '2'.repeat(64), commit: '3'.repeat(40) }];
async function fixture() {
  const f = await buildKitFilesFixture(), inventory = await observeBuildKitInventory(f.root, f.request, AbortSignal.timeout(5000));
  inventory.cache.records.push({ id: mutable, snapshot: mutable, recordType: 'source.local', parents: [], createdNanoseconds: '1789141695097996294', lastUsedNanoseconds: lastUsed },
    { id: alias, snapshot: alias, recordType: 'regular', parents: [], equalMutable: mutable, createdNanoseconds: created, lastUsedNanoseconds: lastUsed },
    { id: foreign, snapshot: foreign, recordType: 'regular', parents: [], blob: foreignBlob, createdNanoseconds: '1789141695097996294' });
  inventory.snapshots.records.push({ ...inventory.snapshots.records[0]!, key: 'buildkit/4/' + mutable, snapshot: mutable, storageId: '4' });
  inventory.results.results = [cacheId, alias, foreign].map(key => ({ key, workerId, cacheId: key, createdAt: own.createdAt }));
  inventory.results.keys = [cacheId, alias, foreign]; inventory.results.links = [cacheId, foreign].map(target => ({ source: alias, target, input: 0, output: 0, digest: blobDigest }));
  const selection = () => buildKitCacheGraphOwnership({ workerId, projectLayers: [blobDigest], foreignLayers: [foreignBlob], foreignResultKeys: [], buildWindows: [{ started: own.createdAt, finished: own.completedAt! }], platformInputs: [] }, inventory);
  const proofs: Array<Awaited<ReturnType<ReturnType<typeof createBuildKitInputClient>['observe']>>> = [{ version: 1, key: 'original', rootIdentity: inventory.rootIdentity, volumeIdentity: inventory.volumeIdentity, templateIdentity: '4'.repeat(64), inputs: [{ storageId: '4', sourceIdentity: '5'.repeat(64), files: [], templateFiles: [{ path: 'Dockerfile', digest: blobDigest }], sharedPlatformContentsProven: false, projectMatches: [{ ...expected[0]!, identity: '6'.repeat(64) }] }], complete: true, identity: '7'.repeat(64), physicalReclamationProven: false, observedAt: new Date().toISOString() }];
  return { ...f, inventory, selection, proofs };
}
test('latest original SCM bytes qualify the mutable input and own immutable alias while preserving older foreign output', async () => {
  const f = await fixture();
  try {
    const result = qualifyBuildKitProjectInputs(f.selection(), f.inventory, f.proofs, expected, [own]);
    expect(result.cacheIds).toEqual([cacheId, mutable, alias].sort()); expect(result.storageIds).toEqual(['134', '4']);
    expect(result.cacheIds).not.toContain(foreign); expect(result.physicalReclamationProven).toBe(false); expect(result.qualified).toHaveLength(1);
    expect(qualifyBuildKitProjectInputs(f.selection(), f.inventory, f.proofs, [], [own]).qualified).toHaveLength(0);
    f.proofs[0]!.inputs[0]!.sharedPlatformContentsProven = true;
    expect(qualifyBuildKitProjectInputs(f.selection(), f.inventory, f.proofs, expected, [own]).qualified).toHaveLength(0);
  } finally { await f.drop(); }
});
test('overlapping foreign work, a foreign immutable alias, missing native history or another original volume cannot qualify deletion', async () => {
  const f = await fixture();
  try {
    const other = { ...own, ref: 'h'.repeat(25), createdAt: '2026-09-30T16:01:17.390000000Z', completedAt: '2026-09-30T16:01:18.000000000Z' };
    expect(() => qualifyBuildKitProjectInputs(f.selection(), f.inventory, f.proofs, expected, [own, other])).toThrow('latest');
    expect(() => qualifyBuildKitProjectInputs(f.selection(), f.inventory, f.proofs, expected, [])).toThrow('complete native history');
    expect(() => qualifyBuildKitProjectInputs(f.selection(), f.inventory, f.proofs, expected, [own, own])).toThrow();
    f.proofs[0]!.volumeIdentity = '8'.repeat(64); expect(() => qualifyBuildKitProjectInputs(f.selection(), f.inventory, f.proofs, expected, [own])).toThrow('another volume'); f.proofs[0]!.volumeIdentity = f.inventory.volumeIdentity;
    f.inventory.cache.records.find(row => row.id === alias)!.createdNanoseconds = '1789141695097996294';
    expect(() => qualifyBuildKitProjectInputs(f.selection(), f.inventory, f.proofs, expected, [own])).toThrow('another build');
  } finally { await f.drop(); }
});
