import { createHash } from 'node:crypto';
import { readBuildKitCacheMetadata } from '../metadata';
import { readBuildKitResultCache } from '../resultCache';
import { readBuildKitSnapshotMetadata } from '../snapshots';
import { readBuildKitContainerdMetadata } from './containerd';
import { openBuildKitFiles } from './files';
import { BuildKitInventoryRequestSchema, BuildKitInventoryResponseSchema, buildKitInventoryRequestIdentity, validateBuildKitInventoryQuery } from './protocol';
import type { BuildKitInventoryRequest } from './protocol';

/** Read-only original bbolt and physical files. A strict complete EOF still
 * carries no producer, consumer or deletion-success claim. */
export async function observeBuildKitInventory(root: string, raw: BuildKitInventoryRequest, signal: AbortSignal) {
  const input = BuildKitInventoryRequestSchema.parse(raw), files = await openBuildKitFiles(root, input, signal);
  try {
    const cache = readBuildKitCacheMetadata(await files.read('runc-overlayfs/metadata_v2.db'));
    const results = readBuildKitResultCache(await files.read('cache.db'));
    const snapshots = readBuildKitSnapshotMetadata(await files.read('runc-overlayfs/snapshots/metadata.db'));
    const containerd = readBuildKitContainerdMetadata(await files.read('runc-overlayfs/containerdmeta.db'));
    if (results.results.some(row => row.workerId !== files.workerId)) throw Error('Native BuildKit cache belongs to a different original worker');
    if (files.files.some(row => row.path.startsWith('content/') && row.kind !== 'file')) throw Error('Native BuildKit selected content is not a regular original blob');
    await files.verify(); signal.throwIfAborted();
    const databases = files.databases.map(({ path, identity, revision }) => ({ path, identity, revision }));
    const material = { rootIdentity: files.rootIdentity, volumeIdentity: files.volumeIdentity, workerId: files.workerId, databases,
      cache, results, snapshots, containerd, files: files.files, allStorageIds: files.allStorageIds, allContentDigests: files.allContentDigests,
      absentStorageIds: files.absentStorageIds, absentContent: files.absentContent };
    return validateBuildKitInventoryQuery(input, BuildKitInventoryResponseSchema.parse({ ...material, key: input.key, requestIdentity: buildKitInventoryRequestIdentity(input), version: 'buildkit-native-files/1',
      complete: true, observedAt: new Date().toISOString(), revision: createHash('sha256').update(JSON.stringify(material)).digest('hex'),
      physicalReclamationProven: false, producersClosed: false, consumersStopped: false }));
  } finally { await files.close(); }
}
