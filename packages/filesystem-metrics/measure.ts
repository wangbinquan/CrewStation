import { constants } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import type { BigIntStats } from 'node:fs';
import { resolve, join } from 'node:path';

const directoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
// Production probes run on Linux, where every lookup stays relative to a pinned directory.
// Other POSIX hosts support local measurement with an identity check at each directory boundary.
const fdPath = (fd: number, path: string) => process.platform === 'linux' ? `/proc/self/fd/${fd}` : path;
const identity = (s: BigIntStats) => `${s.dev}:${s.ino}`;
interface Scan { device: bigint; seen: Set<string>; entries: number; signal: AbortSignal }
async function scanDirectory(handle: FileHandle, path: string, scan: Scan, depth: number): Promise<bigint> {
  scan.signal.throwIfAborted();
  if (depth > 128) throw new Error('Directory depth limit exceeded');
  const before = await handle.stat({ bigint: true });
  if (identity(await lstat(path, { bigint: true })) !== identity(before)) throw new Error('Directory changed during measurement');
  if (before.dev !== scan.device || scan.seen.has(identity(before))) return 0n;
  scan.seen.add(identity(before)); let blocks = before.blocks;
  const names = await readdir(fdPath(handle.fd, path));
  for (const name of names) {
    scan.signal.throwIfAborted(); if (++scan.entries > 2_000_000) throw new Error('Directory entry limit exceeded');
    const childPath = join(fdPath(handle.fd, path), name), entry = await lstat(childPath, { bigint: true });
    if (entry.dev !== scan.device || scan.seen.has(identity(entry))) continue;
    if (entry.isDirectory()) {
      const child = await open(childPath, directoryFlags);
      try {
        if (identity(await child.stat({ bigint: true })) !== identity(entry)) throw new Error('Directory changed during measurement');
        blocks += await scanDirectory(child, childPath, scan, depth + 1);
      } finally { await child.close(); }
    } else { scan.seen.add(identity(entry)); blocks += entry.blocks; }
  }
  scan.signal.throwIfAborted(); return blocks;
}
/** Only directory entries and stat metadata are read; links and other filesystems are not followed. */
export async function measureDirectory(root: string, relativePath: string, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  const parts = relativePath.split('/');
  if (!root.startsWith('/') || parts.some((p) => !p || p === '.' || p === '..' || p.includes('\0')) || relativePath.length > 2000) throw new Error('Invalid relative directory');
  const handles: FileHandle[] = [];
  try {
    let path = resolve(root), handle = await open(path, directoryFlags); handles.push(handle);
    for (const part of parts) { signal.throwIfAborted(); path = join(fdPath(handle.fd, path), part); handle = await open(path, directoryFlags); handles.push(handle); }
    const before = await handle.stat({ bigint: true }), total = await scanDirectory(handle, path, { device: before.dev, seen: new Set(), entries: 0, signal }, 0);
    // Check the original path as well as the pinned descriptor: a replaced mount target is not the same observation.
    const after = await lstat(join(root, relativePath), { bigint: true });
    if (!after.isDirectory() || identity(before) !== identity(after)) throw new Error('Directory changed during measurement');
    return String(total * 512n);
  } finally { await Promise.all(handles.reverse().map((h) => h.close())); }
}
