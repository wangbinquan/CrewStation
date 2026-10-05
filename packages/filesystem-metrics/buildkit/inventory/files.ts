import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { lstat, open, readdir, readlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { filesystemSourceEpoch } from '../../source';
import { BuildKitNativeFileSchema } from './protocol';
import type { BuildKitInventoryRequest } from './protocol';

const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const stamp = (stat: BigIntStats) => [stat.dev, stat.ino, stat.birthtimeNs, stat.mtimeNs, stat.ctimeNs, stat.size, stat.blocks, stat.nlink, stat.mode].map(String).join(':');
type Pinned = { path: string; handle: FileHandle; stat: BigIntStats };
export async function openBuildKitFiles(root: string, input: BuildKitInventoryRequest, signal: AbortSignal) {
  if (!isAbsolute(root)) throw Error('Native BuildKit read-only root is invalid');
  const handles: FileHandle[] = [], pinned = new Map<string, string>(); let device: bigint;
  const from = (parent: Pinned) => process.platform === 'linux' ? '/proc/self/fd/' + parent.handle.fd : parent.path;
  const pin = async (path: string, physical: string, kind: 'directory' | 'file'): Promise<Pinned> => {
    signal.throwIfAborted(); const handle = await open(physical, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK | (kind === 'directory' ? constants.O_DIRECTORY : 0));
    handles.push(handle); const stat = await handle.stat({ bigint: true });
    if (device !== undefined && device !== stat.dev || !(kind === 'directory' ? stat.isDirectory() : stat.isFile()) || kind === 'file' && stat.nlink !== 1n) throw Error('Native BuildKit source aliases or crosses its original filesystem');
    filesystemSourceEpoch(stat, kind); pinned.set(path, stamp(stat)); return { path, handle, stat };
  };
  const below = async (relative: string, kind: 'directory' | 'file', start: Pinned) => {
    let parent = start; const names = relative.split('/');
    for (const [i, name] of names.entries()) parent = await pin(join(parent.path, name), join(from(parent), name), i === names.length - 1 ? kind : 'directory');
    return parent;
  };
  try {
    const source = await pin(root, root, 'directory'); device = source.stat.dev;
    const volume = await below(input.directory, 'directory', source);
    const snapshotRoot = await below('runc-overlayfs/snapshots/snapshots', 'directory', volume);
    const contentRoot = await below('runc-overlayfs/content/blobs/sha256', 'directory', volume);
    const allStorageIds = (await readdir(from(snapshotRoot))).sort(), allContentDigests = (await readdir(from(contentRoot))).sort().map(name => 'sha256:' + name);
    const databases: Array<{ path: string; identity: string; revision: string; bytes: Buffer; original: Pinned }> = [];
    const read = async (path: string) => {
      const original = await below(path, 'file', volume), bytes = await boundedFile(original.handle, 67_108_864, signal);
      if (stamp(await original.handle.stat({ bigint: true })) !== stamp(original.stat)) throw Error('Native BuildKit database changed while reading');
      databases.push({ path, identity: filesystemSourceEpoch(original.stat, 'file'), revision: hash(bytes), bytes, original }); return bytes;
    };
    const worker = await below('runc-overlayfs/workerid', 'file', volume), workerBytes = await boundedFile(worker.handle, 128, signal);
    const files: Array<ReturnType<typeof BuildKitNativeFileSchema.parse>> = [], absentStorageIds: string[] = [], absentContent: string[] = [];
    for (const id of input.storageIds) await walkSelection(snapshotRoot, id, 'snapshots/' + id, signal, files, pinned, handles, device, absentStorageIds);
    for (const digest of input.contentDigests) await walkSelection(contentRoot, digest.slice(7), 'content/' + digest.slice(7), signal, files, pinned, handles, device, absentContent, digest);
    const verify = async () => {
      for (const database of databases) if (hash(await boundedFile(database.original.handle, 67_108_864, signal)) !== database.revision) throw Error('Native BuildKit database changed during full inventory');
      for (const [path, original] of pinned) { signal.throwIfAborted(); if (stamp(await lstat(path, { bigint: true })) !== original) throw Error('Native BuildKit source or files changed during full inventory'); }
    };
    const workerText = new TextDecoder('utf-8', { fatal: true }).decode(workerBytes);
    if (!/^[a-z0-9]{20,40}\n?$/.test(workerText)) throw Error('Native BuildKit original worker ID file is unsupported');
    return { read, verify, files, absentStorageIds, absentContent, allStorageIds, allContentDigests, databases, workerId: workerText.replace(/\n$/, ''),
      rootIdentity: filesystemSourceEpoch(source.stat, 'directory'), volumeIdentity: filesystemSourceEpoch(volume.stat, 'directory'),
      close: async () => { await Promise.all(handles.splice(0).map(handle => handle.close())); } };
  } catch (error) { await Promise.all(handles.map(handle => handle.close())); throw error; }
}
async function boundedFile(handle: FileHandle, maximum: number, signal: AbortSignal): Promise<Buffer> {
  const chunks: Buffer[] = [], buffer = Buffer.alloc(65_536); let size = 0;
  for (;;) {
    signal.throwIfAborted(); const { bytesRead } = await handle.read(buffer, 0, buffer.length, size); if (!bytesRead) break;
    size += bytesRead; if (size > maximum) throw Error('Native BuildKit file exceeded its complete read budget'); chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
  } return Buffer.concat(chunks, size);
}
async function walkSelection(parent: Pinned, name: string, relative: string, signal: AbortSignal, files: Array<ReturnType<typeof BuildKitNativeFileSchema.parse>>,
  pinned: Map<string, string>, handles: FileHandle[], device: bigint, absent: string[], absentKey = name, depth = 0): Promise<void> {
  signal.throwIfAborted(); if (depth > 64 || files.length >= 200_000 || !name || name === '.' || name === '..' || /[\/\0]/.test(name)) throw Error('Native BuildKit full file walk exceeded its supported layout');
  const path = join(parent.path, name), physical = join(process.platform === 'linux' ? '/proc/self/fd/' + parent.handle.fd : parent.path, name);
  let stat: BigIntStats;
  try { stat = await lstat(physical, { bigint: true }); }
  catch (error) { if (!depth && (error as NodeJS.ErrnoException).code === 'ENOENT') { absent.push(absentKey); return; } throw error; }
  // OCI overlay snapshots retain native zero-device whiteouts. Observe their
  // inode only; never open a device or follow it outside the snapshot tree.
  const whiteout = relative.startsWith('snapshots/') && stat.isCharacterDevice() && stat.rdev === 0n && stat.size === 0n;
  if (stat.dev !== device || !stat.isFile() && !stat.isDirectory() && !stat.isSymbolicLink() && !whiteout || stat.birthtimeNs <= 0n) throw Error('Native BuildKit file tree contains an unsupported source');
  const kind = whiteout ? 'whiteout' as const : stat.isDirectory() ? 'directory' as const : stat.isSymbolicLink() ? 'symlink' as const : 'file' as const;
  const identity = kind === 'symlink' || kind === 'whiteout' ? hash(JSON.stringify([kind, String(stat.dev), String(stat.ino), String(stat.birthtimeNs)])) : filesystemSourceEpoch(stat, kind);
  files.push(BuildKitNativeFileSchema.parse({ path: relative, kind, identity, device: String(stat.dev), inode: String(stat.ino), birthtimeNs: String(stat.birthtimeNs), bytes: kind === 'directory' ? 0 : Number(stat.size), allocatedBytes: Number(stat.blocks * 512n), links: Number(stat.nlink) })); pinned.set(path, stamp(stat));
  if (kind === 'symlink') { await readlink(physical); return; }
  if (kind === 'directory') {
    const handle = await open(physical, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY); handles.push(handle);
    try {
      if (stamp(await handle.stat({ bigint: true })) !== stamp(stat)) throw Error('Native BuildKit directory changed during walk');
      const child = { path, handle, stat }, names = (await readdir(process.platform === 'linux' ? '/proc/self/fd/' + handle.fd : path)).sort();
      for (const next of names) await walkSelection(child, next, relative + '/' + next, signal, files, pinned, handles, device, absent, absentKey, depth + 1);
    } finally { await handle.close(); handles.splice(handles.indexOf(handle), 1); }
  }
}
