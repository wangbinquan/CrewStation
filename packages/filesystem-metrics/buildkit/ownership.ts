import { createHash } from 'node:crypto';
import { z } from 'zod';
import { readBuildKitCacheMetadata } from './metadata';
import type { BuildKitCacheRecord } from './metadata';
import { readBuildKitResultCache } from './resultCache';
import { readBuildKitSnapshotMetadata } from './snapshots';

const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/), id = z.string().regex(/^[a-z0-9]{20,40}$/);
const request = z.strictObject({ workerId: id, projectLayers: z.array(digest), foreignLayers: z.array(digest), foreignResultKeys: z.array(z.string().min(1)),
  buildWindows: z.array(z.strictObject({ started: z.iso.datetime(), finished: z.iso.datetime() })),
  platformInputs: z.array(z.strictObject({ snapshotKey: z.string().min(1), storageId: z.string().regex(/^[1-9][0-9]*$/), created: z.string().regex(/^[a-f0-9]{30}$/), sourceIdentity: z.string().regex(/^[a-f0-9]{64}$/),
    files: z.array(z.strictObject({ path: z.string().min(1), kind: z.enum(['file', 'directory', 'symlink']), digest: digest.optional() })),
    templateFiles: z.array(z.strictObject({ path: z.string().min(1), digest })) })) });
export type BuildKitOwnershipRequest = z.infer<typeof request>;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function closure(roots: Iterable<string>, parents: ReadonlyMap<string, readonly string[]>) {
  const found = new Set<string>(), pending = [...roots];
  while (pending.length) { const value = pending.pop()!; if (found.has(value)) continue; found.add(value); pending.push(...parents.get(value) ?? []); }
  return found;
}
function nanoseconds(value: string) {
  const parsed = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?Z$/.exec(value);
  if (!parsed) throw Error('Native BuildKit build window is unsupported');
  return BigInt(Date.parse(parsed[1]! + 'Z')) * 1_000_000n + BigInt((parsed[2] ?? '').padEnd(9, '0'));
}
function platformInputs(input: BuildKitOwnershipRequest, snapshots: ReturnType<typeof readBuildKitSnapshotMetadata>) {
  const protectedIds = new Set<string>();
  for (const proof of input.platformInputs) {
    const original = snapshots.records.find(row => row.key === proof.snapshotKey);
    if (!original || original.storageId !== proof.storageId || original.created !== proof.created || !proof.files.length
      || new Set(proof.files.map(row => row.path)).size !== proof.files.length || new Set(proof.templateFiles.map(row => row.path)).size !== proof.templateFiles.length) throw Error('Native BuildKit platform input birth or complete file scope is invalid');
    const files = new Map(proof.templateFiles.map(row => [row.path, row.digest]));
    if (proof.files.some(row => row.kind === 'symlink' || row.kind === 'file' && (!row.digest || files.get(row.path) !== row.digest)
      || row.kind === 'directory' && ![...files.keys()].some(path => path.startsWith(row.path + '/')))
      || !proof.files.some(row => row.kind === 'file')) throw Error('Native BuildKit input contains content outside the independent platform template');
    protectedIds.add(original.snapshot);
  }
  return protectedIds;
}

/** Select original cache identities from complete native graphs. This is a
 * read-only scope, not permission to prune. Unattributed local inputs remain
 * explicit blockers; neither reuse counts nor generic cache names prove sharing. */
export function buildKitCacheOwnership(raw: BuildKitOwnershipRequest, bytes: { cache: Uint8Array; results: Uint8Array; snapshots: Uint8Array }) {
  const input = request.parse(structuredClone(raw)), cache = readBuildKitCacheMetadata(bytes.cache), results = readBuildKitResultCache(bytes.results), snapshots = readBuildKitSnapshotMetadata(bytes.snapshots);
  if (results.results.some(row => row.workerId !== input.workerId) || input.foreignResultKeys.some(key => !results.keys.includes(key))) throw Error('Native BuildKit result belongs to another original worker or incomplete foreign scope');
  const windows = input.buildWindows.map(row => ({ started: nanoseconds(row.started), finished: nanoseconds(row.finished) }));
  if (windows.some(row => row.finished < row.started)) throw Error('Native BuildKit build window is inverted');
  const parents = new Map<string, string[]>();
  for (const link of results.links) { const current = parents.get(link.target) ?? []; current.push(link.source); parents.set(link.target, current); }
  const projectLayers = new Set(input.projectLayers), foreignLayers = new Set(input.foreignLayers);
  const projectIds = new Set(cache.records.filter(row => row.blob && projectLayers.has(row.blob)).map(row => row.id));
  const foreignIds = new Set(cache.records.filter(row => row.blob && foreignLayers.has(row.blob)).map(row => row.id));
  const projectKeys = closure(results.results.filter(row => projectIds.has(row.cacheId)).map(row => row.key), parents);
  const foreignKeys = closure([...input.foreignResultKeys, ...results.results.filter(row => foreignIds.has(row.cacheId)).map(row => row.key)], parents);
  const nativeParents = new Map(cache.records.map(row => [row.id, [...row.parents, ...(row.equalMutable ? [row.equalMutable] : [])]]));
  const owned = closure([...projectIds, ...results.results.filter(row => projectKeys.has(row.key)).map(row => row.cacheId)], nativeParents);
  const shared = closure([...foreignIds, ...results.results.filter(row => foreignKeys.has(row.key)).map(row => row.cacheId)], nativeParents);
  const platform = platformInputs(input, snapshots);
  const platformRecords = new Set(cache.records.filter(row => platform.has(row.snapshot)).map(row => row.id));
  // The original daemon creates an immutable alias for a reused mutable input.
  // Its native equalMutable edge identifies the same proven platform bytes;
  // ordinary parent edges must not turn project output into platform content.
  for (const row of cache.records) if (platformRecords.has(row.id) || row.equalMutable && platformRecords.has(row.equalMutable)) shared.add(row.id);
  const inWindow = (row: BuildKitCacheRecord) => windows.some(window => [row.createdNanoseconds, row.lastUsedNanoseconds].some(value => value && BigInt(value) >= window.started && BigInt(value) <= window.finished));
  const missingResults = results.results.filter(row => projectKeys.has(row.key) && !cache.records.some(record => record.id === row.cacheId));
  const unknown = cache.records.filter(row => inWindow(row) && !owned.has(row.id) && !shared.has(row.id));
  const exclusive = cache.records.filter(row => owned.has(row.id) && !shared.has(row.id));
  const snapshotOwners = (set: ReadonlySet<string>) => new Set(cache.records.filter(row => set.has(row.id)).flatMap(row => [row.snapshot, ...(row.equalMutable ? [row.equalMutable] : [])]));
  const exclusiveSnapshots = snapshotOwners(new Set(exclusive.map(row => row.id))), sharedSnapshots = snapshotOwners(shared);
  const physical = snapshots.records.filter(row => exclusiveSnapshots.has(row.snapshot) || exclusiveSnapshots.has(row.snapshot.replace(/-view$/, '')));
  if (physical.some(row => sharedSnapshots.has(row.snapshot))) throw Error('Native BuildKit exclusive snapshot aliases another owner');
  const material = { version: 1 as const, workerId: input.workerId, cache, results, snapshots, input,
    exclusive: exclusive.map(row => ({ id: row.id, createdNanoseconds: row.createdNanoseconds, equalMutable: row.equalMutable ?? null })),
    physical, shared: cache.records.filter(row => owned.has(row.id) && shared.has(row.id)).map(row => row.id).sort(),
    unknown: unknown.map(row => row.id).sort(), missingResults: missingResults.map(row => ({ key: row.key, cacheId: row.cacheId })), complete: !unknown.length && !missingResults.length };
  return { ...material, identity: hash(material), physicalReclamationProven: false as const };
}
