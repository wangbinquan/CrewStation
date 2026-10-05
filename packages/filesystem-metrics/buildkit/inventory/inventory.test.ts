import { expect, test } from 'bun:test';
import { link, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { observeBuildKitInventory } from './inventory';
import { openBuildKitFiles } from './files';
import { buildKitFilesFixture, blobDigest, cacheId, workerId } from './fixture';

test('actual original binary databases and full selected tree retain all four epochs, lease graph and original file births without private bytes', async () => {
  const f = await buildKitFilesFixture();
  try {
    const result = await observeBuildKitInventory(f.root, f.request, AbortSignal.timeout(5000));
    expect(result).toMatchObject({ complete: true, workerId, physicalReclamationProven: false, producersClosed: false, consumersStopped: false });
    expect(result.cache.records[0]).toMatchObject({ id: cacheId, createdNanoseconds: '1790784077263787585' });
    expect(result.databases).toHaveLength(4); expect(new Set(result.databases.map(row => row.identity)).size).toBe(4);
    expect(result.snapshots.records[0]).toMatchObject({ storageId: '134', key: 'buildkit/196/' + cacheId });
    expect(result.containerd.leases[0]).toMatchObject({ id: cacheId, content: [blobDigest] });
    expect(result.allStorageIds).toEqual(['134']); expect(result.allContentDigests).toEqual([blobDigest]);
    expect(result.files.map(row => row.path)).toEqual(['snapshots/134', 'snapshots/134/fs', 'snapshots/134/fs/result', 'content/' + blobDigest.slice(7)]);
    expect(result.files.every(row => row.identity && row.inode && row.birthtimeNs)).toBe(true); expect(JSON.stringify(result)).not.toContain('original-private-secret');
    expect(JSON.stringify(result)).not.toContain('original-project-result');
    expect(result.absentContent).toEqual([]); expect(result.absentStorageIds).toEqual([]);
  } finally { await f.drop(); }
});
test('actual native file removal is observed independently but no read-only result can certify physical deletion', async () => {
  const f = await buildKitFilesFixture();
  try {
    await rm(join(f.volume, 'runc-overlayfs/snapshots/snapshots/134'), { recursive: true });
    await rm(join(f.volume, 'runc-overlayfs/content/blobs/sha256', blobDigest.slice(7)));
    const result = await observeBuildKitInventory(f.root, f.request, AbortSignal.timeout(5000));
    expect(result.files).toEqual([]); expect(result.absentStorageIds).toEqual(['134']); expect(result.absentContent).toEqual([blobDigest]);
    expect(result.containerd.leases).toHaveLength(1); expect(result.snapshots.records).toHaveLength(1); expect(result.physicalReclamationProven).toBe(false);
  } finally { await f.drop(); }
});
test('a byte-identical replacement of the original database cannot pass a retained handle verification', async () => {
  const f = await buildKitFilesFixture();
  try {
    const source = await openBuildKitFiles(f.root, f.request, AbortSignal.timeout(5000));
    try {
      const bytes = await source.read('cache.db'), path = join(f.volume, 'cache.db');
      await rename(path, path + '.original'); await writeFile(path, bytes);
      await expect(source.verify()).rejects.toThrow('changed');
    } finally { await source.close(); }
  } finally { await f.drop(); }
});
test('symlink or hardlink database sources, unknown physical roots, aborted scans and changed file trees fail closed', async () => {
  const f = await buildKitFilesFixture();
  try {
    const path = join(f.volume, 'cache.db'); await link(path, path + '.alias');
    await expect(observeBuildKitInventory(f.root, f.request, AbortSignal.timeout(5000))).rejects.toThrow('aliases'); await rm(path + '.alias');
    await rename(path, path + '.original'); await symlink(path + '.original', path);
    await expect(observeBuildKitInventory(f.root, f.request, AbortSignal.timeout(5000))).rejects.toThrow(); await rm(path); await rename(path + '.original', path);
    const source = await openBuildKitFiles(f.root, f.request, AbortSignal.timeout(5000));
    try { await writeFile(join(f.volume, 'runc-overlayfs/snapshots/snapshots/134/fs/result'), 'replaced'); await expect(source.verify()).rejects.toThrow('changed'); }
    finally { await source.close(); }
    await expect(observeBuildKitInventory(f.root, { ...f.request, directory: '../foreign' }, AbortSignal.timeout(5000))).rejects.toThrow();
    const cancelled = AbortSignal.abort(); await expect(observeBuildKitInventory(f.root, f.request, cancelled)).rejects.toThrow();
  } finally { await f.drop(); }
});
