import { expect, test } from 'bun:test';
import { observeBuildKitInventory } from '../inventory/inventory';
import { buildKitFilesFixture, cacheId, blobDigest, workerId } from '../inventory/fixture';
import { buildKitCacheGraphOwnership } from '../ownership';
import { qualifyBuildKitStaleResults } from './staleResults';
import type { BuildKitInventoryResponse } from '../inventory/protocol';
const stale = 'd'.repeat(25), key = 'e'.repeat(25), root = 'f'.repeat(25), at = '2026-09-30T16:01:17.263787585Z';
async function fixture() {
  const f = await buildKitFilesFixture(), inventory: BuildKitInventoryResponse = await observeBuildKitInventory(f.root, f.request, AbortSignal.timeout(5000));
  inventory.results.keys = [key, root];
  inventory.results.results = [{ key: root, workerId, cacheId, createdAt: at }, { key, workerId, cacheId: stale, createdAt: at }];
  inventory.results.links = [{ source: key, target: root, input: 0, output: 0, digest: blobDigest }];
  const selection = () => buildKitCacheGraphOwnership({ workerId, projectLayers: [blobDigest], foreignLayers: [], foreignResultKeys: [], buildWindows: [], platformInputs: [] }, inventory);
  return { ...f, inventory, selection };
}
test('a retained stale result is qualified only after full native graphs and physical catalogs prove that its cache, leases and snapshots are absent', async () => {
  const f = await fixture();
  try {
    const selection = f.selection(); expect(selection.complete).toBe(false); expect(selection.missingResults).toEqual([{ key, cacheId: stale }]);
    const result = qualifyBuildKitStaleResults(selection, f.inventory, []);
    expect(result.complete).toBe(true); expect(result.retained).toHaveLength(1);
    expect(result.retained[0]).toMatchObject({ key, cacheId: stale, births: [{ workerId, createdAt: at }], materialAbsent: true });
    expect(result).toMatchObject({ physicalReclamationProven: false, producersClosed: false, consumersStopped: false });
  } finally { await f.drop(); }
});
test('live leases, unresolved snapshot aliases, orphan physical roots/content and native ingests remain blockers', async () => {
  const f = await fixture();
  try {
    const original = f.selection();
    for (const mode of ['lease', 'unresolved view', 'orphan directory', 'orphan content', 'ingest']) {
      const inventory = structuredClone(f.inventory);
      if (mode === 'lease') inventory.containerd.leases.push({ ...inventory.containerd.leases[0]!, id: stale });
      if (mode === 'unresolved view') inventory.containerd.unresolvedSnapshots.push({ source: cacheId, target: stale + '-view', kind: 'child' });
      if (mode === 'orphan directory') inventory.allStorageIds.push('999');
      if (mode === 'orphan content') inventory.allContentDigests.push('sha256:' + '9'.repeat(64));
      if (mode === 'ingest') inventory.containerd.ingests = 1;
      const result = qualifyBuildKitStaleResults(original, inventory, []); expect(result.complete).toBe(false); expect(result.blockers.length).toBeGreaterThan(0);
    }
    const usage = [{ id: stale, createdAt: at, mutable: false, inUse: true, size: 0, usageCount: 0, recordType: 'regular' as const, shared: false, parents: [] }];
    expect(qualifyBuildKitStaleResults(original, f.inventory, usage).complete).toBe(false);
  } finally { await f.drop(); }
});
test('a substituted source graph, omitted original result or another worker cannot qualify the retained metadata', async () => {
  const f = await fixture();
  try {
    const original = f.selection(), changed = structuredClone(f.inventory); changed.results.results.pop();
    expect(() => qualifyBuildKitStaleResults(original, changed, [])).toThrow('original graph');
    expect(() => qualifyBuildKitStaleResults({ ...original, workerId: 'z'.repeat(25) }, f.inventory, [])).toThrow('worker');
  } finally { await f.drop(); }
});
