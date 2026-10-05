import { constants } from 'node:fs';
import { lstat, open, rmdir, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { filesystemSourceEpoch } from '../source';
import { registryDirectory, registryFile, registryOwnsRepository } from './graph';
import { observeRegistryInventory } from './inventory';
import { RegistryInventoryRequestSchema, RegistryInventoryResponseSchema, registryRequestIdentity } from './protocol';
import type { RegistryInventoryResponse } from './protocol';

export const RegistryReclamationRequestSchema = z.strictObject({ query: RegistryInventoryRequestSchema, original: RegistryInventoryResponseSchema });
export type RegistryReclamationRequest = z.infer<typeof RegistryReclamationRequestSchema>;
type NativeEntry = RegistryInventoryResponse['entries'][number];
/** Supplied by the deployment's private native host, never by an HTTP caller.
 * It must hold producer exclusion across the entire transaction and inspect
 * every original inode, including already unlinked open descriptors. */
export interface RegistryReclamationAuthority {
  exclusive<T>(original: RegistryReclamationRequest, work: () => Promise<T>): Promise<T>;
  assertClosed(original: RegistryReclamationRequest, signal: AbortSignal): Promise<void>;
}
const sameEpoch = (actual: { identity: string; device: string; inode: string; birthtimeNs: string }, original: typeof actual) =>
  actual.identity === original.identity && actual.device === original.device && actual.inode === original.inode && actual.birthtimeNs === original.birthtimeNs;
const owns = registryOwnsRepository;

function request(raw: RegistryReclamationRequest): RegistryReclamationRequest {
  const value = RegistryReclamationRequestSchema.parse(structuredClone(raw)), { query, original } = value;
  if (original.key !== query.key || original.requestIdentity !== registryRequestIdentity(query)) throw Error('Registry reclamation scope does not match the captured inventory');
  if (new Set(original.entries.map(row => row.path)).size !== original.entries.length || new Set(original.blobs.map(row => row.digest)).size !== original.blobs.length) throw Error('Registry reclamation original identities are duplicated');
  for (const row of original.entries) {
    if (!row.path.startsWith('repositories/') || !owns(query, row.path.slice(13).split('/_')[0]!)) throw Error('Registry reclamation cannot select a foreign native path');
    if (row.kind === 'directory') registryDirectory(row.path); else registryFile(row);
  }
  for (const row of original.blobs) {
    const parsed = registryFile({ ...row, kind: 'file' });
    if (parsed.kind !== 'blob' || parsed.digest !== row.digest || row.otherRepositories.some(name => owns(query, name))) throw Error('Registry reclamation original blob graph is inconsistent');
  }
  return value;
}

/** Exact original repository files and exclusive blobs only. No recursive rm,
 * global GC, tag-only inventory or caller-provided "closed" boolean. This is
 * a native mutation acknowledgement; the owner still performs an independent
 * source/consumer observation before issuing its physical completion receipt. */
export async function reclaimRegistryInventory(root: string, raw: RegistryReclamationRequest, authority: RegistryReclamationAuthority,
  signal: AbortSignal = AbortSignal.timeout(60_000)) {
  if (!isAbsolute(root) || process.platform !== 'linux') throw Error('Registry native reclamation requires the original Linux filesystem');
  const original = request(raw), retainedDigests = [...new Set([...original.query.retainedDigests, ...original.query.retainedManifests, ...original.original.blobs.map(row => row.digest)])].sort();
  // All original descendants are retained before removing links. Re-inspection
  // then needs no deleted manifest body to rediscover its former descendants.
  const currentQuery = { ...original.query, retainedDigests, retainedManifests: [] };
  return authority.exclusive(structuredClone(original), async () => {
    const closed = async () => { signal.throwIfAborted(); await authority.assertClosed(structuredClone(original), signal); signal.throwIfAborted(); };
    const observe = async () => {
      await closed(); const current = await observeRegistryInventory(root, currentQuery, signal);
      if (current.rootIdentity !== original.original.rootIdentity || current.volumeIdentity !== original.original.volumeIdentity) throw Error('Registry native root or original volume was replaced');
      for (const row of current.entries) {
        const birth = original.original.entries.find(value => value.path === row.path);
        if (!birth || birth.kind !== row.kind || !sameEpoch(row, birth) || row.kind === 'file' && (row.bytes !== birth.bytes || row.allocatedBytes !== birth.allocatedBytes)) throw Error('Registry original repository acquired new or changed content');
      }
      for (const row of current.blobs) {
        const birth = original.original.blobs.find(value => value.digest === row.digest);
        if (!birth || !sameEpoch(row, birth) || row.bytes !== birth.bytes || row.allocatedBytes !== birth.allocatedBytes) throw Error('Registry original blob was replaced or changed');
      }
      await closed(); return current;
    };
    let current = await observe(); const removed: string[] = [];
    // Links, orphan upload files and empty owned directories precede blobs.
    // Ancestors belonging to other repositories are never selected.
    const entries = [...current.entries].sort((a, b) => Number(a.kind === 'directory') - Number(b.kind === 'directory') || b.path.split('/').length - a.path.split('/').length || a.path.localeCompare(b.path));
    for (const entry of entries) {
      await closed(); await erase(root, original, entry, closed); removed.push(entry.identity); await closed();
    }
    current = await observe();
    for (const birth of original.original.blobs) {
      const actual = current.blobs.find(row => row.digest === birth.digest);
      if (!actual || actual.otherRepositories.length) continue;
      await closed(); await erase(root, original, { ...actual, kind: 'file' }, closed); removed.push(actual.identity); await closed();
      // The exclusive native authority prevents writers between the complete
      // foreign graph scan and unlink. Re-scan before every subsequent blob.
      current = await observe();
    }
    current = await observe();
    return { kind: 'acknowledged' as const, removed, remainingEntries: current.entries.length,
      remainingExclusiveBlobs: current.blobs.filter(row => !row.otherRepositories.length).length,
      shared: current.blobs.filter(row => row.otherRepositories.length).map(row => ({ digest: row.digest, identity: row.identity, bytes: row.bytes })),
      inventory: current, physicalReclamationProven: false as const };
  });
}

async function erase(root: string, original: RegistryReclamationRequest, entry: NativeEntry, closed: () => Promise<void>) {
  const handles: FileHandle[] = [], pinned: Array<{ path: string; handle: FileHandle; identity: string }> = [];
  const openDirectory = async (path: string, expected?: string) => {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY | constants.O_NONBLOCK); handles.push(handle);
    const identity = filesystemSourceEpoch(await handle.stat({ bigint: true }), 'directory');
    if (expected && identity !== expected) throw Error('Registry pinned original directory was replaced');
    return { handle, identity };
  };
  try {
    let path = root, parent = await openDirectory(root, original.original.rootIdentity);
    pinned.push({ path, ...parent });
    const parts = [original.query.directory, 'docker', 'registry', 'v2', ...entry.path.split('/')];
    for (let index = 0; index < parts.length - 1; index++) {
      path = join(path, parts[index]!);
      parent = await openDirectory(join(`/proc/self/fd/${parent.handle.fd}`, parts[index]!), index === 0 ? original.original.volumeIdentity : undefined);
      const stat = await parent.handle.stat({ bigint: true });
      if (String(stat.dev) !== entry.device) throw Error('Registry reclamation crossed the original filesystem');
      pinned.push({ path, ...parent });
    }
    const name = parts.at(-1)!, leaf = join(`/proc/self/fd/${parent.handle.fd}`, name);
    const handle = await open(leaf, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK | (entry.kind === 'directory' ? constants.O_DIRECTORY : 0)); handles.push(handle);
    const stat = await handle.stat({ bigint: true });
    if (filesystemSourceEpoch(stat, entry.kind) !== entry.identity || String(stat.dev) !== entry.device || String(stat.ino) !== entry.inode || String(stat.birthtimeNs) !== entry.birthtimeNs
      || entry.kind === 'file' && (Number(stat.size) !== entry.bytes || Number(stat.blocks * 512n) !== entry.allocatedBytes || stat.nlink !== 1n)) throw Error('Registry reclamation original file identity or size changed');
    // The native eraser must not appear as an old payload consumer when the
    // independent host rechecks the entire node immediately before unlink.
    await handle.close(); handles.splice(handles.indexOf(handle), 1);
    await closed();
    for (const item of pinned) if (filesystemSourceEpoch(await lstat(item.path, { bigint: true }), 'directory') !== item.identity) throw Error('Registry reclamation original path changed');
    if (filesystemSourceEpoch(await lstat(leaf, { bigint: true }), entry.kind) !== entry.identity) throw Error('Registry reclamation original leaf changed');
    if (entry.kind === 'directory') await rmdir(leaf); else await unlink(leaf);
  } finally { await Promise.all(handles.map(handle => handle.close())); }
}
