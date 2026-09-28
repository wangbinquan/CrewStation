import { createHash } from 'node:crypto';
import { createReadStream, constants } from 'node:fs';
import { lstat, readFile, open } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { ResourceIdSchema, StorageBytesSchema } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import { digestBackupFile } from './backupBundle';

const digest = z.strictObject({ size: StorageBytesSchema, sha256: z.string().regex(/^[a-f0-9]{64}$/) });
const header = z.strictObject({ version: z.literal(1), backupId: ResourceIdSchema, snapshot: digest, index: digest, objectCount: StorageBytesSchema, bytes: StorageBytesSchema });
const entry = z.strictObject({ id: ResourceIdSchema, spaceId: ResourceIdSchema, backendId: ResourceIdSchema, placementRevision: z.number().int().positive(), key: z.string().min(1).max(1024), size: StorageBytesSchema, sha256: z.string().regex(/^[a-f0-9]{64}$/) });
export type BackupObjectEntry = z.infer<typeof entry>;

/** Offline bundle reads are bounded and must be tied to a recorded manifest digest. */
export async function readBackupBundle(directory: string, manifestDigest: string, signal: AbortSignal) {
  const manifestPath = join(directory, 'manifest.json'); await regular(manifestPath);
  if ((await lstat(manifestPath)).size > 16_384) throw precondition('备份清单头超限');
  const raw = await readFile(manifestPath);
  if (createHash('sha256').update(raw).digest('hex') !== manifestDigest) throw precondition('备份清单摘要不匹配');
  const manifest = header.parse(JSON.parse(raw.toString()));
  for (const [name, expected] of [['platform.pgdump', manifest.snapshot], ['objects.ndjson', manifest.index]] as const) {
    const path = join(directory, name); await regular(path); const actual = await digestBackupFile(path, signal);
    if (actual.size !== expected.size || actual.sha256 !== expected.sha256) throw precondition('备份快照或索引摘要不匹配');
  }
  const objectDirectory = join(directory, 'objects'); if (!(await lstat(objectDirectory)).isDirectory()) throw precondition('备份对象目录无效');
  return {
    manifest,
    entries: () => readEntries(join(directory, 'objects.ndjson'), manifest, signal),
    content: async (object: BackupObjectEntry) => {
      const path = join(objectDirectory, `${ResourceIdSchema.parse(object.id)}.blob`); await regular(path);
      const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      return Readable.toWeb(file.createReadStream({ highWaterMark: 64 * 1024, signal })) as unknown as ReadableStream<Uint8Array>;
    },
    verify: async () => {
      for await (const object of readEntries(join(directory, 'objects.ndjson'), manifest, signal)) {
        const path = join(objectDirectory, `${object.id}.blob`); await regular(path); const actual = await digestBackupFile(path, signal);
        if (actual.size !== object.size || actual.sha256 !== object.sha256) throw precondition('备份对象摘要不匹配');
      }
      return manifest;
    },
  };
}
async function regular(path: string) { if (!(await lstat(path)).isFile()) throw precondition('备份只能读取普通文件，不能包含符号链接'); }
async function* readEntries(path: string, manifest: z.infer<typeof header>, signal: AbortSignal): AsyncGenerator<BackupObjectEntry> {
  let pending = '', count = 0, bytes = 0, previous = '';
  const decode = (line: string) => {
    if (Buffer.byteLength(line) > 8192) throw precondition('备份对象索引行超限');
    const item = entry.parse(JSON.parse(line));
    if (item.id <= previous) throw precondition('备份对象索引重复或乱序'); previous = item.id;
    count++; bytes += item.size;
    if (count > manifest.objectCount || bytes > manifest.bytes || !Number.isSafeInteger(bytes)) throw precondition('备份对象清单超出声明');
    return item;
  };
  for await (const chunk of createReadStream(path, { encoding: 'utf8', highWaterMark: 16_384, signal })) {
    pending += chunk as string;
    let newline: number;
    while ((newline = pending.indexOf('\n')) >= 0) { const line = pending.slice(0, newline); pending = pending.slice(newline + 1); yield decode(line); }
    if (Buffer.byteLength(pending) > 8192) throw precondition('备份对象索引行超限');
  }
  if (pending || count !== manifest.objectCount || bytes !== manifest.bytes) throw precondition('备份对象索引不完整');
}
