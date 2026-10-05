import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boltCacheFixture, boltSnapshotFixture } from '../fixture';

export const cacheId = 'a'.repeat(25), workerId = 'b'.repeat(25), blobDigest = 'sha256:' + 'c'.repeat(64);
export async function buildKitFilesFixture() {
  const root = await mkdtemp(join(tmpdir(), 'cs-buildkit-original-')), directory = 'original-volume', volume = join(root, directory);
  const created = Buffer.from('010000000ee24f294d1038f2cbffff', 'hex'), zero = Buffer.alloc(0);
  await mkdir(join(volume, 'runc-overlayfs/snapshots/snapshots/134/fs'), { recursive: true });
  await mkdir(join(volume, 'runc-overlayfs/content/blobs/sha256'), { recursive: true });
  const originalFields = [
    { key: 'id', value: Buffer.from([0x86, 1]) }, { key: 'kind', value: Buffer.from([3]) }, { key: 'createdat', value: created },
  ];
  const blob = [{ key: 'createdat', value: created }, { key: 'updatedat', value: created }, { key: 'size', value: Buffer.from([24]) }];
  const content = [{ key: 'blob', value: [{ key: blobDigest, value: blob }] }, { key: 'ingests', value: [] }];
  const containerd = [{ key: 'v1', value: [{ key: 'version', value: Buffer.from([5]) },
    { key: 'buildkit', value: [{ key: 'content', value: content }, { key: 'leases', value: [{ key: cacheId, value: [{ key: 'createdat', value: created }, { key: 'content', value: [{ key: blobDigest, value: zero }] }] }] }] },
    { key: 'buildkit_history', value: [{ key: 'content', value: content }, { key: 'leases', value: [] }] }] }];
  const databaseBytes: Record<string, Buffer> = {
    'runc-overlayfs/metadata_v2.db': boltCacheFixture([{ id: cacheId, fields: { 'cache.createdAt': '{"value":1790784077263787585}', 'cache.recordType': '{"value":"regular"}', 'cache.blob': '{"value":"' + blobDigest + '"}', 'cache.description': '{"value":"original-private-secret"}' } }]),
    'cache.db': boltSnapshotFixture(['_links', '_result', '_byresult', '_backlinks'].map(key => ({ key, value: [] }))),
    'runc-overlayfs/snapshots/metadata.db': boltSnapshotFixture([{ key: 'v1', value: [{ key: 'snapshots', value: [{ key: 'buildkit/196/' + cacheId, value: originalFields }] }] }]),
    'runc-overlayfs/containerdmeta.db': boltSnapshotFixture(containerd),
  };
  for (const [path, bytes] of Object.entries(databaseBytes)) await writeFile(join(volume, path), bytes);
  await writeFile(join(volume, 'runc-overlayfs/workerid'), workerId);
  await writeFile(join(volume, 'runc-overlayfs/snapshots/snapshots/134/fs/result'), 'original-project-result');
  await writeFile(join(volume, 'runc-overlayfs/content/blobs/sha256', blobDigest.slice(7)), 'originalblob');
  return { root, volume, databaseBytes, request: { key: 'original-native-buildkit', rootId: 'local', directory, storageIds: ['134'], contentDigests: [blobDigest] },
    drop: () => rm(root, { recursive: true }) };
}
