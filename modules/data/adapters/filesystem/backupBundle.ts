import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, stat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { precondition, validation } from '@crewstation/kernel';
import type { BackupBlobDigest, ObjectBackupSink } from '../../ports/objectBackups';

/** Operator-selected independent destination. Never falls back to service or task storage. */
export async function fileBackupBundle(input: { directory: string; snapshot(path: string, signal: AbortSignal): Promise<void> }): Promise<ObjectBackupSink> {
  if (!isAbsolute(input.directory)) throw validation('备份目的地必须是显式绝对路径');
  await mkdir(input.directory, { mode: 0o700 }); // EEXIST prevents accidental overwrite, including a symlink.
  const objectsDirectory = join(input.directory, 'objects'); await mkdir(objectsDirectory, { mode: 0o700 });
  const indexPath = join(input.directory, 'objects.ndjson');
  const index = await open(indexPath, 'wx', 0o600); await index.close();
  let sealed = false, snapshot: BackupBlobDigest | undefined;
  const writable = () => { if (sealed) throw precondition('备份清单已经封存'); };
  return {
    snapshot: async (signal) => {
      writable(); if (snapshot) throw precondition('快照已经写入');
      const path = join(input.directory, 'platform.pgdump'); await input.snapshot(path, signal);
      const mode = await stat(path); if (!mode.isFile() || (mode.mode & 0o077)) throw precondition('备份快照必须是仅当前用户可读写的普通文件');
      snapshot = await digestBackupFile(path, signal); return snapshot;
    },
    object: async (object, body, signal) => {
      writable(); if (!snapshot || !/^[0-9a-f-]{36}$/.test(object.id)) throw precondition('备份未取得快照或对象标识无效');
      const path = join(objectsDirectory, `${object.id}.blob`), file = await open(path, 'wx', 0o600), reader = body.getReader();
      let size = 0;
      try {
        while (true) { signal.throwIfAborted(); const next = await reader.read(); if (next.done) break;
          size += next.value.byteLength; if (size > object.size) throw precondition('备份对象长度超出声明'); await writeAll(file, next.value);
        }
        await file.sync();
      } catch (error) { await reader.cancel(error).catch(() => undefined); throw error; }
      finally { reader.releaseLock(); await file.close(); }
      const actual = await digestBackupFile(path, signal);
      if (actual.size !== object.size || actual.sha256 !== object.sha256) throw precondition('备份对象读回校验失败');
      const entry = { id: object.id, spaceId: object.spaceId, backendId: object.backendId, placementRevision: object.placementRevision, key: object.key, size: object.size, sha256: object.sha256 };
      const manifest = await open(indexPath, 'a'); try { await writeAll(manifest, Buffer.from(`${JSON.stringify(entry)}\n`)); await manifest.sync(); } finally { await manifest.close(); }
      return actual;
    },
    seal: async (summary, signal) => {
      writable(); if (!snapshot || JSON.stringify(summary.snapshot) !== JSON.stringify(snapshot)) throw precondition('备份快照摘要不一致');
      const index = await digestBackupFile(indexPath, signal), body = JSON.stringify({ version: 1, ...summary, index });
      const manifest = await open(join(input.directory, 'manifest.json'), 'wx', 0o600);
      try { await writeAll(manifest, Buffer.from(body)); await manifest.sync(); } finally { await manifest.close(); }
      await syncDirectory(objectsDirectory); await syncDirectory(input.directory); sealed = true;
      return createHash('sha256').update(body).digest('hex');
    },
  };
}
export async function digestBackupFile(path: string, signal: AbortSignal): Promise<BackupBlobDigest> {
  const hash = createHash('sha256'); let size = 0;
  for await (const chunk of createReadStream(path, { highWaterMark: 64 * 1024, signal })) { const bytes = chunk as Buffer; size += bytes.length; hash.update(bytes); }
  return { size, sha256: hash.digest('hex') };
}
async function writeAll(file: FileHandle, bytes: Uint8Array) {
  let offset = 0;
  while (offset < bytes.length) { const result = await file.write(bytes, offset, bytes.length - offset); if (!result.bytesWritten) throw new Error('Backup file write stalled'); offset += result.bytesWritten; }
}
async function syncDirectory(path: string) { const directory = await open(path, 'r'); try { await directory.sync(); } finally { await directory.close(); } }
