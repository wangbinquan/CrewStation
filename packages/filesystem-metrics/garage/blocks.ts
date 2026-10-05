import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { filesystemSourceEpoch } from '../source';

export interface GarageBlockCopy { readonly hash: string; readonly path: string; readonly identity: string; readonly bytes: number;
  readonly allocatedBytes: number; readonly device: string; readonly inode: string; readonly birthtimeNs: string }
const stamp = (stat: BigIntStats) => [stat.dev, stat.ino, stat.birthtimeNs, stat.mtimeNs, stat.ctimeNs, stat.size, stat.blocks, stat.nlink, stat.mode].map(String).join(':');
const fdPath = (handle: FileHandle, path: string) => process.platform === 'linux' ? `/proc/self/fd/${handle.fd}` : path;
const hashName = /^([a-f0-9]{64})(?:\.zst(?:\.corrupted)?|\.corrupted|\.tmp[a-f0-9]{8})?$/;

/** A complete walk finds old plain/compressed, corrupt and interrupted-write
 * copies as well as the current layout. No bytes are read or removed. */
export async function observeGarageBlocks(root: string, directory: string, hashes: readonly string[], signal: AbortSignal) {
  if (!isAbsolute(root) || !/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,252}$/.test(directory)
    || hashes.length > 100_000 || new Set(hashes).size !== hashes.length || hashes.some(hash => !/^[a-f0-9]{64}$/.test(hash))) throw Error('garage-block-scope-invalid');
  const originals = new Set(hashes), copies: GarageBlockCopy[] = [], handles: FileHandle[] = [], seen = new Map<string, string>();
  let device: bigint, count = 0;
  const pin = async (path: string, relative: string, parent?: { handle: FileHandle; path: string }) => {
    signal.throwIfAborted();
    const handle = await open(parent ? join(fdPath(parent.handle, parent.path), relative) : path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    handles.push(handle); const stat = await handle.stat({ bigint: true });
    if (device !== undefined && stat.dev !== device || !stat.isDirectory() && !stat.isFile()) throw Error('garage-block-unsupported-source');
    seen.set(path, stamp(stat)); return { handle, path, stat };
  };
  try {
    const base = await pin(root, ''); if (!base.stat.isDirectory()) throw Error('garage-block-root-invalid'); device = base.stat.dev;
    const volume = await pin(join(root, directory), directory, base); if (!volume.stat.isDirectory()) throw Error('garage-block-volume-invalid');
    const walk = async (parent: typeof volume, relative: string, depth: number): Promise<void> => {
      if (depth > 48) throw Error('garage-block-scan-depth');
      const names = (await readdir(fdPath(parent.handle, parent.path))).sort();
      for (const name of names) {
        if (++count > 100_000 || !/^[A-Za-z0-9_.-]+$/.test(name) || name === '.' || name === '..') throw Error('garage-block-full-scan-budget');
        const child = await pin(join(parent.path, name), name, parent), path = relative ? relative + '/' + name : name;
        if (child.stat.isDirectory()) await walk(child, path, depth + 1);
        else {
          const match = hashName.exec(name), hash = match?.[1];
          // Unknown spellings of a retained hash block a false zero result.
          if (!hash && originals.has(name.slice(0, 64))) throw Error('garage-block-unknown-copy-format');
          if (hash && originals.has(hash)) {
            const bytes = Number(child.stat.size), allocatedBytes = Number(child.stat.blocks * 512n);
            if (![bytes, allocatedBytes].every(value => Number.isSafeInteger(value) && value >= 0)) throw Error('garage-block-size-invalid');
            copies.push({ hash, path, bytes, allocatedBytes, identity: filesystemSourceEpoch(child.stat, 'file'),
              device: String(child.stat.dev), inode: String(child.stat.ino), birthtimeNs: String(child.stat.birthtimeNs) });
          }
        }
        await child.handle.close(); handles.splice(handles.indexOf(child.handle), 1);
      }
    };
    await walk(volume, '', 0);
    for (const [path, original] of seen) {
      signal.throwIfAborted(); if (stamp(await lstat(path, { bigint: true })) !== original) throw Error('garage-block-source-changed');
    }
    return { rootIdentity: filesystemSourceEpoch(base.stat, 'directory'), volumeIdentity: filesystemSourceEpoch(volume.stat, 'directory'),
      copies, scanned: count, complete: true as const, readonly: true as const, observedAt: new Date().toISOString(),
      revision: createHash('sha256').update(JSON.stringify(copies)).digest('hex') };
  } finally { await Promise.all(handles.map(handle => handle.close())); }
}
