import { createHash } from 'node:crypto';
import { buildKitCacheGraphOwnership } from '../ownership';
import type { BuildKitInventoryResponse } from '../inventory/protocol';
import type { createBuildKitInputClient } from './transport';
import type { GitInputExpectation } from './gitInputs';
import type { BuildKitHistory } from '../controlRecords';

type Inputs = Awaited<ReturnType<ReturnType<typeof createBuildKitInputClient>['observe']>>;
const hash = (raw: unknown) => createHash('sha256').update(JSON.stringify(raw)).digest('hex');
const nanos = (raw: string) => { const [whole, decimal = ''] = raw.replace(/Z$/, '').split('.'); return BigInt(Date.parse(whole! + 'Z')) * 1_000_000n + BigInt(decimal.padEnd(9, '0')); };
/** A source.local mutable context can be updated across unrelated builds.
 * Old result links do not own its latest bytes. Select it only when full native
 * bytes match an independently retained original SCM tree, the latest native
 * use and every immutable alias belong to this project's complete build, and
 * the original project result graph actually reaches that input. Foreign
 * immutable outputs remain protected by the native reclamation scope. */
export function qualifyBuildKitProjectInputs(selection: ReturnType<typeof buildKitCacheGraphOwnership>, inventory: BuildKitInventoryResponse,
  proofs: readonly Inputs[], expected: readonly GitInputExpectation[], histories: readonly BuildKitHistory[]) {
  if (buildKitCacheGraphOwnership(selection.input, inventory).identity !== selection.identity) throw Error('Native project input ownership graph changed');
  const windows = selection.input.buildWindows.map(row => ({ from: nanos(row.started), to: nanos(row.finished) }));
  if (new Set(histories.map(row => row.ref)).size !== histories.length || windows.some(window => !histories.some(row => row.event === 'complete' && nanos(row.createdAt) === window.from && row.completedAt && nanos(row.completedAt) === window.to))) throw Error('Original project build windows are not present in the complete native history');
  const inWindow = (value: string) => windows.some(row => BigInt(value) >= row.from && BigInt(value) <= row.to);
  const latestOwnUse = (value: string) => windows.some(window => BigInt(value) >= window.from
    && !histories.some(row => !windows.some(own => nanos(row.createdAt) === own.from && row.completedAt && nanos(row.completedAt) === own.to)
      && nanos(row.createdAt) <= BigInt(value) && (!row.completedAt || nanos(row.completedAt) >= window.from)));
  const selected = new Set(selection.exclusive.map(row => row.id)), qualified: Array<{ storageId: string; ids: string[]; identity: string }> = [];
  for (const proof of proofs) {
    if (!proof.complete || proof.rootIdentity !== inventory.rootIdentity || proof.volumeIdentity !== inventory.volumeIdentity) throw Error('Original SCM input source is another volume or incomplete');
    for (const input of proof.inputs) {
      if (input.sharedPlatformContentsProven) continue;
      const matched = input.projectMatches?.filter(row => expected.some(before => before.repositoryIdentity === row.repositoryIdentity && before.commit === row.commit)) ?? [];
      if (!matched.length) continue;
      const snapshot = inventory.snapshots.records.find(row => row.storageId === input.storageId), record = inventory.cache.records.find(row => row.id === snapshot?.snapshot);
      if (!snapshot || !record) throw Error('Original SCM context snapshot is absent from its native cache graph');
      if (!selected.has(record.id) && !selection.shared.includes(record.id)) continue;
      if (record.recordType !== 'source.local' || record.blob || !record.lastUsedNanoseconds || !latestOwnUse(record.lastUsedNanoseconds)) throw Error('Original SCM context has no bound latest project build ancestry');
      const aliases = inventory.cache.records.filter(row => row.equalMutable === record.id);
      if (aliases.some(row => row.blob || row.parents.length || !inWindow(row.createdNanoseconds))) throw Error('Original SCM context still has an immutable alias from another build');
      const ids = [record.id, ...aliases.map(row => row.id)]; ids.forEach(id => selected.add(id));
      qualified.push({ storageId: input.storageId, ids, identity: hash({ originalSnapshot: snapshot, input, expected: matched }) });
    }
  }
  const ids = [...selected].sort(), storageIds = [...new Set([...selection.physical.map(row => row.storageId), ...qualified.map(row => row.storageId)])].sort();
  const body = { ownershipIdentity: selection.identity, qualified, cacheIds: ids, storageIds, unknown: selection.unknown.filter(id => !selected.has(id)) };
  return { ...body, identity: hash(body), physicalReclamationProven: false as const };
}
