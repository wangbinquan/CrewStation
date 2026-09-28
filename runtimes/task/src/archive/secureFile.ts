import { closeSync, constants, fstatSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { ArchiveFileError } from './failure';
import type { FileHandle } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { ArchivePathSchema, OBJECT_STORAGE_LIMITS } from '@crewstation/contracts';

interface FileIdentity { readonly dev: bigint; readonly ino: bigint; readonly size: bigint; readonly mode: bigint; readonly mtimeNs: bigint; readonly ctimeNs: bigint }
const same = (a: FileIdentity, b: FileIdentity) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mode === b.mode && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
export class MissingArchiveFile extends ArchiveFileError { constructor() { super('archive_file_missing', '归档文件不存在'); } }

/** Linux openat2 resolves every component under a held /work fd, without symlinks, magic links or mount crossings. */
export async function openArchiveFile(root: string, path: string): Promise<FileHandle> {
  ArchivePathSchema.parse(path);
  if (process.platform !== 'linux' || !['x64', 'arm64'].includes(process.arch)) throw new ArchiveFileError('archive_file_unsafe', '归档文件安全读取需要 Linux x64/arm64 openat2');
  const { dlopen, toArrayBuffer } = await import('bun:ffi');
  const libc = dlopen('libc.so.6', { syscall: { args: ['i64', 'i64', 'ptr', 'ptr', 'u64'], returns: 'i64' }, __errno_location: { args: [], returns: 'ptr' } });
  const directory = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  let pinned = -1;
  try {
    // O_PATH prevents opening a selected device/FIFO for I/O before checking that it is an ordinary file.
    const how = new BigUint64Array([0x200000n | 0x80000n, 0n, 0x0fn]);
    pinned = Number(libc.symbols.syscall(437n, BigInt(directory.fd), Buffer.from(`${path}\0`), how, BigInt(how.byteLength)));
    if (pinned < 0) {
      const errno = new Int32Array(toArrayBuffer(libc.symbols.__errno_location()!, 0, 4))[0];
      if (errno === 2) throw new MissingArchiveFile();
      throw new ArchiveFileError('archive_file_unsafe', `归档文件无法安全打开（errno=${errno}）`);
    }
    const before = fstatSync(pinned, { bigint: true });
    if (!before.isFile()) throw new ArchiveFileError('archive_file_unsafe', '归档路径必须指向普通文件');
    if (before.size > BigInt(OBJECT_STORAGE_LIMITS.objectBytes)) throw new ArchiveFileError('archive_file_too_large', '归档文件超过单对象上限');
    // This proc link is generated from our own held descriptor, never from an application path.
    const handle = await open(`/proc/self/fd/${pinned}`, constants.O_RDONLY | constants.O_NONBLOCK);
    if (!same(before, await handle.stat({ bigint: true }))) { await handle.close(); throw new ArchiveFileError('archive_file_changed', '归档文件在打开时发生变化'); }
    return handle;
  } finally { if (pinned >= 0) closeSync(pinned); await directory.close(); libc.close(); }
}

/** A fixed-size chunk stream; the same fd and nanosecond identity are checked across hashing and upload. */
export async function describeArchiveFile(handle: FileHandle) {
  const identity = await handle.stat({ bigint: true }), size = Number(identity.size);
  const stable = async () => { if (!same(identity, await handle.stat({ bigint: true }))) throw new ArchiveFileError('archive_file_changed', '归档过程中源文件发生变化'); };
  const stream = () => {
    let offset = 0;
    return new ReadableStream<Uint8Array>({ pull: async (controller) => {
      try {
        if (offset === size) { await stable(); controller.close(); return; }
        const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, size - offset)), result = await handle.read(buffer, 0, buffer.length, offset);
        if (!result.bytesRead) throw new ArchiveFileError('archive_file_changed', '归档过程中源文件长度发生变化');
        offset += result.bytesRead; controller.enqueue(buffer.subarray(0, result.bytesRead));
      } catch (error) { controller.error(error); }
    } }, { highWaterMark: 1 });
  };
  const hash = createHash('sha256'), reader = stream().getReader();
  try { while (true) { const chunk = await reader.read(); if (chunk.done) break; hash.update(chunk.value); } } finally { reader.releaseLock(); }
  await stable();
  return { size, sha256: hash.digest('hex'), stream, stable };
}
