import { createHash } from 'node:crypto';
import { z } from 'zod';
import { RegistryInventoryRequestSchema, RegistryInventoryResponseSchema, registryRequestIdentity } from './protocol';
import type { RegistryInventoryResponse } from './protocol';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const consumerSource = z.strictObject({ identity: hash, probeUid: z.uuid(), containerId: z.string().min(1), imageId: z.string().min(1), nodeUid: z.uuid(), nodeName: z.string().min(1), bootId: z.uuid(), namespace: z.string().min(1) });
export const RegistryDeletionHistorySchema = z.strictObject({ version: z.literal(1), projectId: z.uuid(), sourceIdentity: hash, origin: z.json(),
  query: RegistryInventoryRequestSchema, original: RegistryInventoryResponseSchema, consumers: consumerSource });
export type RegistryDeletionHistory = z.infer<typeof RegistryDeletionHistorySchema>;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function retainedCoverage(history: RegistryDeletionHistory, inventory: RegistryInventoryResponse) {
  const expected = { ...history.query, ...retainedRegistryQuery(history), key: inventory.key };
  const observed = new Set(inventory.blobs.map(row => row.digest)), absent = new Set(inventory.retainedAbsent);
  if (inventory.requestIdentity !== registryRequestIdentity(expected) || absent.size !== inventory.retainedAbsent.length
    || inventory.retainedAbsent.some(value => observed.has(value)) || expected.retainedDigests.some(value => !observed.has(value) && !absent.has(value))) throw Error('Registry current inventory omitted the retained original graph');
}

/** Persist the complete original graph, not just tags still visible in the UI.
 * Credentials and blob payloads never belong to this native history. */
export function captureRegistryHistory(raw: RegistryDeletionHistory): RegistryDeletionHistory {
  const history = RegistryDeletionHistorySchema.parse(structuredClone(raw));
  if (history.original.key !== history.query.key || history.original.requestIdentity !== registryRequestIdentity(history.query)) throw Error('Registry retained history does not match the original request');
  return history;
}
export function retainedRegistryQuery(raw: RegistryDeletionHistory) {
  const history = captureRegistryHistory(raw);
  return { exact: [...history.query.exact], prefixes: [...history.query.prefixes], retainedManifests: [],
    ...(history.query.protectedRepositories ? { protectedRepositories: [...history.query.protectedRepositories] } : {}),
    retainedDigests: [...new Set([...history.query.retainedDigests, ...history.query.retainedManifests, ...history.original.blobs.map(row => row.digest)])].sort() };
}
/** Stable material identity omits transport timestamps but retains the entire
 * original inode set, shared graph and independently pinned native origins. */
export function registryHistoryIdentity(raw: RegistryDeletionHistory): string {
  const history = captureRegistryHistory(raw), { observedAt: _observedAt, revision: _wholeTreeRevision, requestIdentity: _requestIdentity, key: _key, ...original } = history.original;
  return digest({ version: history.version, projectId: history.projectId, sourceIdentity: history.sourceIdentity, origin: history.origin,
    query: { exact: history.query.exact, prefixes: history.query.prefixes, retainedDigests: history.query.retainedDigests, retainedManifests: history.query.retainedManifests, protectedRepositories: history.query.protectedRepositories }, original, consumers: history.consumers });
}
export function bindRegistryHistory(raw: RegistryDeletionHistory, current: { identity: string; origin: unknown; inventory: RegistryInventoryResponse }) {
  const history = captureRegistryHistory(raw), inventory = RegistryInventoryResponseSchema.parse(current.inventory);
  retainedCoverage(history, inventory);
  if (current.identity !== history.sourceIdentity || digest(current.origin) !== digest(history.origin)
    || inventory.rootIdentity !== history.original.rootIdentity || inventory.volumeIdentity !== history.original.volumeIdentity) throw Error('Registry original software instance, native root or volume changed');
  const files = new Map(history.original.entries.map(row => [row.path, row]));
  for (const row of inventory.entries) {
    const original = files.get(row.path);
    if (!original || original.kind !== row.kind || original.identity !== row.identity || row.kind === 'file' && (original.bytes !== row.bytes || original.allocatedBytes !== row.allocatedBytes)) throw Error('Registry acquired new content or a same-name replacement after confirmation');
  }
  const blobs = new Map(history.original.blobs.map(row => [row.digest, row]));
  for (const row of inventory.blobs) {
    const original = blobs.get(row.digest);
    if (!original || original.path !== row.path || original.identity !== row.identity || original.bytes !== row.bytes || original.allocatedBytes !== row.allocatedBytes) throw Error('Registry original digest or physical blob was replaced');
  }
  return { native: inventory.entries.length, storage: inventory.blobs.filter(row => !row.otherRepositories.length).length,
    allocatedBytes: inventory.entries.filter(row => row.kind === 'file').reduce((sum, row) => sum + row.allocatedBytes, 0)
      + inventory.blobs.filter(row => !row.otherRepositories.length).reduce((sum, row) => sum + row.allocatedBytes, 0) };
}
/** Old unlinked regular-file identities stay in the consumer scan. A current
 * independently verified foreign reference makes a blob shared, so its users
 * must not be stopped by this project's cleanup. */
export function registryExclusiveConsumerFiles(raw: RegistryDeletionHistory, current: RegistryInventoryResponse) {
  const history = captureRegistryHistory(raw), inventory = RegistryInventoryResponseSchema.parse(current);
  retainedCoverage(history, inventory);
  const shared = new Set(inventory.blobs.filter(row => row.otherRepositories.length).map(row => row.digest));
  return [...new Map([...history.original.entries.filter(row => row.kind === 'file'), ...history.original.blobs.filter(row => !shared.has(row.digest))]
    .map(row => [row.device + ':' + row.inode, { device: row.device, inode: row.inode }])).values()];
}

const observationSchema = z.strictObject({ identity: hash, sourceIdentity: hash, native: z.number().int().nonnegative(), storage: z.number().int().nonnegative(), allocatedBytes: z.number().int().nonnegative(),
  consumerCount: z.number().int().nonnegative(), consumerDigest: hash, inventory: RegistryInventoryResponseSchema,
  independent: z.literal(true), physicalReclamationProven: z.literal(false) });
/** Validate an independently observed result against all retained bytes before
 * dispatching a native effect. A correct-looking aggregate alone is insufficient. */
export function validateRegistryHistoryObservation(raw: RegistryDeletionHistory, observation: unknown) {
  const history = captureRegistryHistory(raw), current = observationSchema.parse(observation);
  const remaining = bindRegistryHistory(history, { identity: current.sourceIdentity, origin: history.origin, inventory: current.inventory });
  if (current.identity !== registryHistoryIdentity(history) || current.native !== remaining.native || current.storage !== remaining.storage || current.allocatedBytes !== remaining.allocatedBytes) throw Error('Registry current observation does not match the original retained graph');
  return current;
}
