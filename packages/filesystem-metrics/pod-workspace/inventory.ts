import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { filesystemSourceEpoch } from '../source';
import { KubeletPodIdentitySchema, PodWorkspaceRequestSchema, PodWorkspaceResponseSchema } from './protocol';
import type { PodWorkspaceRequest, PodWorkspaceResponse } from './protocol';

type Pinned = { handle: FileHandle; path: string; stat: BigIntStats };
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const stamp = (stat: BigIntStats) => [stat.dev, stat.ino, stat.birthtimeNs, stat.mtimeNs, stat.ctimeNs, stat.size, stat.blocks, stat.nlink, stat.mode].map(String).join(':');
const missing = (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
type Files = PodWorkspaceResponse['volumes'][number]['files'];
/** Observe only the installation's kubelet emptyDir root. No removal or file
 * contents are exposed. All inode kinds are retained without opening devices,
 * sockets, FIFOs or following symlinks; a complete EOF is required. */
export async function observePodWorkspaces(root: string, raw: PodWorkspaceRequest, signal = AbortSignal.timeout(30_000)): Promise<PodWorkspaceResponse> {
  const input = PodWorkspaceRequestSchema.parse(raw); if (!isAbsolute(root)) throw Error('Native kubelet workspace root must be installation-owned');
  const handles: FileHandle[] = [], observed = new Map<string, string>(), absent: string[] = [];
  const from = (parent: Pinned) => process.platform === 'linux' ? '/proc/self/fd/' + parent.handle.fd : parent.path;
  const pin = async (path: string, physical: string, device?: bigint): Promise<Pinned> => {
    signal.throwIfAborted(); const handle = await open(physical, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK | constants.O_DIRECTORY); handles.push(handle);
    const stat = await handle.stat({ bigint: true }); filesystemSourceEpoch(stat, 'directory');
    if (device !== undefined && stat.dev !== device) throw Error('Native kubelet workspace ancestry crossed its filesystem');
    observed.set(path, stamp(stat)); return { path, handle, stat };
  };
  const below = async (parent: Pinned, name: string, allowVolumeMount = false) => pin(join(parent.path, name), join(from(parent), name), allowVolumeMount ? undefined : parent.stat.dev);
  const optional = async (parent: Pinned, name: string, allowVolumeMount = false) => {
    try { return await below(parent, name, allowVolumeMount); } catch (error) { if (!missing(error)) throw error; absent.push(join(parent.path, name)); return null; }
  };
  try {
    const source = await pin(root, root), allPodUids = (await readdir(from(source))).sort();
    // Unrecognized top-level entries mean this is not the complete kubelet Pod root.
    if (allPodUids.some(uid => !KubeletPodIdentitySchema.safeParse(uid).success)) throw Error('Native kubelet Pod root contains an unsupported original identity');
    const pod = await optional(source, input.podUid), volumes: PodWorkspaceResponse['volumes'] = [];
    let empty: Pinned | null = null;
    if (pod) { const parent = await optional(pod, 'volumes'); if (parent) empty = await optional(parent, 'kubernetes.io~empty-dir'); }
    if (empty) {
      const nativeNames = (await readdir(from(empty))).sort();
      if (nativeNames.some(name => !input.volumes.includes(name))) throw Error('Native kubelet emptyDir scope omitted an original volume or contains an unexpected producer');
    }
    for (const name of input.volumes) {
      const original = empty && await optional(empty, name, true), files: Files = [];
      if (original) await walk(original, '', signal, files, observed, handles);
      volumes.push({ name, identity: original ? filesystemSourceEpoch(original.stat, 'directory') : null, files });
    }
    for (const [path, original] of observed) { signal.throwIfAborted(); if (stamp(await lstat(path, { bigint: true })) !== original) throw Error('Native kubelet workspace changed during its complete observation'); }
    for (const path of absent) { signal.throwIfAborted(); try { await lstat(path); } catch (error) { if (missing(error)) continue; throw error; } throw Error('Native kubelet workspace appeared during its absence observation'); }
    const body = { version: 1 as const, key: input.key, podUid: input.podUid, rootIdentity: filesystemSourceEpoch(source.stat, 'directory'),
      podIdentity: pod ? filesystemSourceEpoch(pod.stat, 'directory') : null, allPodUids, volumes, complete: true as const, physicalReclamationProven: false as const };
    return PodWorkspaceResponseSchema.parse({ ...body, revision: hash(body), observedAt: new Date().toISOString() });
  } finally { await Promise.all(handles.map(handle => handle.close())); }
}

async function walk(parent: Pinned, relative: string, signal: AbortSignal, files: Files, observed: Map<string, string>, handles: FileHandle[], depth = 0): Promise<void> {
  if (depth > 64 || files.length >= 200_000) throw Error('Native kubelet workspace exceeds complete observation budget');
  const physical = process.platform === 'linux' ? '/proc/self/fd/' + parent.handle.fd : parent.path, stat = await parent.handle.stat({ bigint: true });
  const kindOf = (value: BigIntStats) => value.isDirectory() ? 'directory' as const : value.isFile() ? 'file' as const : value.isSymbolicLink() ? 'symlink' as const
    : value.isSocket() ? 'socket' as const : value.isFIFO() ? 'fifo' as const : value.isCharacterDevice() && value.rdev === 0n ? 'whiteout' as const : null;
  const kind = kindOf(stat); if (!kind || stat.birthtimeNs <= 0n) throw Error('Native kubelet workspace inode is unsupported');
  files.push({ path: relative, kind, device: String(stat.dev), inode: String(stat.ino), birthtimeNs: String(stat.birthtimeNs), links: Number(stat.nlink),
    identity: hash([kind, String(stat.dev), String(stat.ino), String(stat.birthtimeNs)]), bytes: 0, allocatedBytes: Number(stat.blocks * 512n) });
  for (const name of (await readdir(physical)).sort()) {
    signal.throwIfAborted(); if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\0') || files.length >= 200_000) throw Error('Native kubelet workspace inode name is unsupported');
    const path = join(parent.path, name), source = join(physical, name), current = await lstat(source, { bigint: true }), kind = kindOf(current);
    if (current.dev !== stat.dev || !kind || current.birthtimeNs <= 0n) throw Error('Native kubelet workspace crossed its volume or contains a device'); observed.set(path, stamp(current));
    if (kind === 'directory') {
      const handle = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY); handles.push(handle);
      try { if (stamp(await handle.stat({ bigint: true })) !== stamp(current)) throw Error('Native kubelet directory changed before observation'); await walk({ handle, path, stat: current }, relative ? relative + '/' + name : name, signal, files, observed, handles, depth + 1); }
      finally { await handle.close(); handles.splice(handles.indexOf(handle), 1); }
    } else files.push({ path: relative ? relative + '/' + name : name, kind, device: String(current.dev), inode: String(current.ino), birthtimeNs: String(current.birthtimeNs), links: Number(current.nlink),
      identity: hash([kind, String(current.dev), String(current.ino), String(current.birthtimeNs)]), bytes: Number(current.size), allocatedBytes: Number(current.blocks * 512n) });
  }
}
