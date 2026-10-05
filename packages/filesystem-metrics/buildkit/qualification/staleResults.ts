import { createHash } from 'node:crypto';
import { buildKitCacheGraphOwnership } from '../ownership';
import type { BuildKitInventoryResponse } from '../inventory/protocol';
import { BuildKitInventoryResponseSchema } from '../inventory/protocol';
import { BuildKitUsageSchema } from '../controlRecords';
import type { BuildKitUsage } from '../controlRecords';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sameSet = (a: readonly string[], b: readonly string[]) => JSON.stringify([...new Set(a)].sort()) === JSON.stringify([...new Set(b)].sort());
const alias = (name: string, id: string) => [id, id + '-view'].some(value => name === value || name.endsWith('/' + value));
/** Native result-cache records can outlive the cache object they point to.
 * Keep those exact original metadata births instead of silently discarding
 * them. A lease, snapshot, orphan directory or physical content gap prevents
 * qualification; this is never a reclamation or producer-exit proof. */
export function qualifyBuildKitStaleResults(selection: ReturnType<typeof buildKitCacheGraphOwnership>, rawInventory: BuildKitInventoryResponse, rawUsage: readonly BuildKitUsage[]) {
  const inventory = BuildKitInventoryResponseSchema.parse(structuredClone(rawInventory)), usage = rawUsage.map(row => BuildKitUsageSchema.parse(row));
  const original = buildKitCacheGraphOwnership(selection.input, inventory);
  if (original.identity !== selection.identity || inventory.workerId !== selection.workerId || new Set(usage.map(row => row.id)).size !== usage.length) throw Error('Native BuildKit result qualification changed its original graph or worker');
  const mappedStorage = inventory.snapshots.records.map(row => row.storageId), mappedContent = inventory.containerd.content.map(row => row.digest);
  const blockers: string[] = [];
  if (!sameSet(mappedStorage, inventory.allStorageIds)) blockers.push('unmapped-original-snapshot-directory');
  if (!sameSet(mappedContent, inventory.allContentDigests)) blockers.push('unmapped-original-content-file');
  if (inventory.containerd.ingests || inventory.containerd.leases.some(row => row.ingests)) blockers.push('original-native-ingest-in-flight');
  if (selection.unknown.length) blockers.push('unattributed-original-cache');
  const retained = [];
  for (const result of selection.missingResults) {
    const records = inventory.results.results.filter(row => row.key === result.key && row.cacheId === result.cacheId);
    if (!records.length) throw Error('Original missing result-cache birth was not retained');
    const id = result.cacheId;
    const live = inventory.cache.records.some(row => row.id === id) || usage.some(row => row.id === id)
      || inventory.snapshots.records.some(row => alias(row.snapshot, id) || alias(row.key, id))
      || inventory.containerd.leases.some(row => row.kind === 'cache' && row.id === id || row.snapshots.some(name => alias(name, id)))
      || inventory.containerd.snapshots.some(row => [row.id, row.name, row.parent ?? '', ...row.children, ...row.labels.snapshots].some(name => alias(name, id)))
      || inventory.containerd.unresolvedSnapshots.some(row => alias(row.source, id) || alias(row.target, id));
    if (live) blockers.push('original-result-cache-still-has-native-material:' + id);
    retained.push({ ...result, births: records.map(row => ({ workerId: row.workerId, createdAt: row.createdAt })), identity: hash({ source: inventory.rootIdentity, volume: inventory.volumeIdentity, resultRevision: inventory.results.revision, records }), materialAbsent: !live });
  }
  const body = { version: 1 as const, ownershipIdentity: selection.identity, inventoryRevision: inventory.revision, retained, blockers: [...new Set(blockers)].sort() };
  return { ...body, identity: hash(body), complete: !body.blockers.length, physicalReclamationProven: false as const, producersClosed: false as const, consumersStopped: false as const };
}
