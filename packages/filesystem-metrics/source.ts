import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';

const component = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,252}$/;
const relative = z.string().min(1).max(2000).refine((value) => {
  const parts = value.split('/'); return parts.length <= 12 && parts.every((part) => component.test(part));
});
export const SourceRequestSchema = z.strictObject({
  key: z.string().min(1).max(200), rootId: z.string().min(1).max(50), directory: z.string().regex(component),
  entries: z.array(z.strictObject({ key: z.string().min(1).max(200), relativePath: relative, kind: z.enum(['directory', 'file']) })).min(1).max(32),
}).refine((value) => new Set(value.entries.map((entry) => entry.key)).size === value.entries.length);
export const SourceResponseSchema = z.strictObject({
  key: z.string(), version: z.literal(1), rootIdentity: z.string().regex(/^[a-f0-9]{64}$/), volumeIdentity: z.string().regex(/^[a-f0-9]{64}$/),
  items: z.array(z.strictObject({ key: z.string(), relativePath: z.string(), kind: z.enum(['directory', 'file']), identity: z.string().regex(/^[a-f0-9]{64}$/) })).min(1).max(32),
  observedAt: z.string().datetime(),
});
export type SourceRequest = z.infer<typeof SourceRequestSchema>;
export type SourceResponse = z.infer<typeof SourceResponseSchema>;
interface PinnedSource { readonly handle: FileHandle; readonly path: string; readonly kind: 'directory' | 'file'; readonly identity: string }

export function filesystemSourceEpoch(stat: BigIntStats, kind: PinnedSource['kind']): string {
  if (!(kind === 'directory' ? stat.isDirectory() : stat.isFile()) || stat.ino <= 0n || stat.birthtimeNs <= 0n) throw new Error('Storage source epoch is unavailable');
  return createHash('sha256').update(JSON.stringify([kind, String(stat.dev), String(stat.ino), String(stat.birthtimeNs)])).digest('hex');
}
async function pin(path: string, kind: PinnedSource['kind'], handles: FileHandle[], device?: bigint): Promise<PinnedSource> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK | (kind === 'directory' ? constants.O_DIRECTORY : 0));
  handles.push(handle); const stat = await handle.stat({ bigint: true });
  if (device !== undefined && stat.dev !== device) throw new Error('Storage source crossed a filesystem boundary');
  return { handle, path, kind, identity: filesystemSourceEpoch(stat, kind) };
}

/** Reads metadata only. Inode/birth epochs distinguish copied or recreated sources, not in-place administrator restores. */
export async function observeFilesystemSource(root: string, target: SourceRequest, signal: AbortSignal = AbortSignal.timeout(10_000)): Promise<SourceResponse> {
  SourceRequestSchema.parse(target); if (!isAbsolute(root)) throw new Error('Invalid source root');
  const handles: FileHandle[] = [], pinned: PinnedSource[] = [];
  try {
    signal.throwIfAborted();
    const rootSource = await pin(root, 'directory', handles); pinned.push(rootSource);
    const device = (await rootSource.handle.stat({ bigint: true })).dev;
    const childPath = (parent: PinnedSource, name: string) => join(process.platform === 'linux' ? `/proc/self/fd/${parent.handle.fd}` : parent.path, name);
    signal.throwIfAborted();
    const volumeSource = await pin(childPath(rootSource, target.directory), 'directory', handles, device);
    pinned.push({ ...volumeSource, path: join(root, target.directory) });
    const items: SourceResponse['items'] = [];
    for (const entry of target.entries) {
      let parent: PinnedSource = { ...volumeSource, path: join(root, target.directory) };
      const parts = entry.relativePath.split('/');
      for (let index = 0; index < parts.length; index += 1) {
        signal.throwIfAborted();
        const kind = index === parts.length - 1 ? entry.kind : 'directory', name = parts[index]!;
        const child = await pin(childPath(parent, name), kind, handles, device);
        parent = { ...child, path: join(parent.path, name) }; pinned.push(parent);
      }
      items.push({ ...entry, identity: parent.identity });
    }
    for (const source of pinned) {
      signal.throwIfAborted();
      if (source.identity !== filesystemSourceEpoch(await source.handle.stat({ bigint: true }), source.kind)
        || source.identity !== filesystemSourceEpoch(await lstat(source.path, { bigint: true }), source.kind)) throw new Error('Storage source changed during observation');
    }
    return { key: target.key, version: 1, rootIdentity: rootSource.identity, volumeIdentity: volumeSource.identity, items, observedAt: new Date().toISOString() };
  } finally { await Promise.all(handles.map((handle) => handle.close())); }
}
