import { createHash } from 'node:crypto';
import { open, opendir, lstat } from 'node:fs/promises';
import type { BigIntStats } from 'node:fs';
import { join } from 'node:path';
import type { BusinessDirectoryDto, BusinessDirectoryQuery, BusinessFileDto, BusinessFileQuery } from '@crewstation/contracts';
import { BusinessDirectoryQuerySchema, BusinessFileQuerySchema } from '@crewstation/contracts';
import { RunnerCommandError } from '../commandError';
import { businessPathOpener } from './businessPaths';
import type { OpenBusinessPath } from './businessPaths';

export interface BusinessFiles {
  read(query: BusinessFileQuery): Promise<BusinessFileDto>;
  list(query: BusinessDirectoryQuery): Promise<BusinessDirectoryDto>;
}
const changed = (): RunnerCommandError => new RunnerCommandError('file_version_changed', '文件或目录已变化，请从头重新读取');
const stamp = (s: BigIntStats): string => [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs].join(':');
const digest = (value: string): string => createHash('sha256').update(value).digest('hex');

/** A bounded-memory scan hashes the entire file and captures only the requested byte range. */
export function createBusinessFiles(root: string, openPath: OpenBusinessPath = businessPathOpener(root)): BusinessFiles {
  return {
    read: async (input) => {
      const query = BusinessFileQuerySchema.parse(input), pinned = await openPath(query.path, 'file');
      try {
        const file = await open(pinned.descriptorPath, 'r');
        try {
          const before = await file.stat({ bigint: true });
          if (!before.isFile()) throw new RunnerCommandError('invalid_file_type', '只允许读取普通文件');
          if (before.size > BigInt(Number.MAX_SAFE_INTEGER)) throw new RunnerCommandError('file_too_large', '文件大小超过可寻址范围');
          const size = Number(before.size);
          if (query.offset > size) throw new RunnerCommandError('invalid_offset', '读取位置超过文件末尾');
          const content = Buffer.alloc(Math.min(query.limit, size - query.offset)), chunk = Buffer.alloc(64 * 1024), hash = createHash('sha256');
          let position = 0;
          while (position < size) {
            const { bytesRead } = await file.read(chunk, 0, Math.min(chunk.length, size - position), position);
            if (!bytesRead) throw changed();
            hash.update(chunk.subarray(0, bytesRead));
            const first = Math.max(position, query.offset), last = Math.min(position + bytesRead, query.offset + content.length);
            if (last > first) chunk.copy(content, first - query.offset, first - position, last - position);
            position += bytesRead;
          }
          if (stamp(before) !== stamp(await file.stat({ bigint: true }))) throw changed();
          const version = hash.digest('hex');
          if (query.version !== undefined && query.version !== version) throw changed();
          return { path: query.path, version, size, offset: query.offset, contentBase64: content.toString('base64'), nextOffset: query.offset + content.length < size ? query.offset + content.length : null };
        } finally { await file.close(); }
      } finally { pinned.close(); }
    },
    list: async (input) => listDirectory(openPath, BusinessDirectoryQuerySchema.parse(input)),
  };
}

async function listDirectory(openPath: OpenBusinessPath, query: BusinessDirectoryQuery): Promise<BusinessDirectoryDto> {
  const pinned = await openPath(query.path, 'dir');
  try {
    const anchor = await open(pinned.descriptorPath, 'r');
    try {
      const version = digest(stamp(await anchor.stat({ bigint: true }))), after = decodeCursor(query, version), names: string[] = [];
      const directory = await opendir(pinned.descriptorPath, { bufferSize: 64 });
      // Keep only the smallest limit+1 names after the cursor: bounded memory even for large directories.
      for await (const entry of directory) {
        if (entry.name === '.crewstation' || entry.name <= after || !(entry.isFile() || entry.isDirectory() || entry.isSymbolicLink())) continue;
        let low = 0, high = names.length;
        while (low < high) { const mid = (low + high) >>> 1; if (names[mid]! < entry.name) low = mid + 1; else high = mid; }
        names.splice(low, 0, entry.name);
        if (names.length > query.limit + 1) names.pop();
      }
      const entries: BusinessDirectoryDto['entries'] = [];
      for (const name of names.slice(0, query.limit)) {
        const info = await lstat(join(pinned.descriptorPath, name));
        if (!info.isFile() && !info.isDirectory() && !info.isSymbolicLink()) throw changed();
        entries.push({ name, kind: info.isSymbolicLink() ? 'symlink' : info.isDirectory() ? 'dir' : 'file', size: info.size, modifiedAt: info.mtime.toISOString() });
      }
      if (version !== digest(stamp(await anchor.stat({ bigint: true })))) throw changed();
      const nextCursor = names.length > query.limit ? Buffer.from(JSON.stringify({ path: digest(query.path), version, after: names[query.limit - 1] })).toString('base64url') : null;
      return { path: query.path, entries, nextCursor };
    } finally { await anchor.close(); }
  } finally { pinned.close(); }
}

function decodeCursor(query: BusinessDirectoryQuery, version: string): string {
  if (!query.after) return '';
  try {
    const cursor = JSON.parse(Buffer.from(query.after, 'base64url').toString()) as Record<string, unknown>;
    if (cursor.path !== digest(query.path) || typeof cursor.after !== 'string' || !cursor.after || cursor.after.includes('/') || cursor.after.includes('\0')) throw new Error('cursor');
    if (cursor.version !== version) throw changed();
    return cursor.after;
  } catch (error) {
    if (error instanceof RunnerCommandError) throw error;
    throw new RunnerCommandError('invalid_cursor', '目录游标不合法或不属于该路径');
  }
}
