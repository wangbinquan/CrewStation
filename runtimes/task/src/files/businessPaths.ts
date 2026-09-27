import { dlopen, FFIType, ptr, read } from 'bun:ffi';
import { closeSync, constants, fstatSync, openSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { relative } from 'node:path';
import { BusinessDirectoryQuerySchema } from '@crewstation/contracts';
import { RunnerCommandError, pathDenied } from '../commandError';
import { isInside } from './workdirPath';

export interface PinnedBusinessPath {
  /** Only this descriptor path may be used after validation; never reopen the original pathname. */
  readonly descriptorPath: string;
  readonly fd: number;
  close(): void;
}
export type OpenBusinessPath = (path: string, kind: 'file' | 'dir') => Promise<PinnedBusinessPath>;

// Linux openat2 uses the same syscall number on the supported amd64/arm64 task images.
// O_PATH obtains metadata without opening a device/FIFO for I/O. BENEATH and NO_MAGICLINKS
// make the final lookup atomic with respect to path/link replacement, unlike realpath+open.
const O_PATH = 0x200000, O_CLOEXEC = 0x80000, RESOLVE_BENEATH = 0x08, RESOLVE_NO_MAGICLINKS = 0x02;
let linux: ReturnType<typeof loadLinux> | undefined;
function loadLinux() {
  return dlopen('libc.so.6', {
    syscall: { args: [FFIType.i64, FFIType.i32, FFIType.ptr, FFIType.ptr, FFIType.u64], returns: FFIType.i32 },
    __errno_location: { args: [], returns: FFIType.ptr },
  });
}

/** Production task containers are Linux. Unsupported hosts fail closed, without a path-based fallback. */
export function businessPathOpener(root: string): OpenBusinessPath {
  return async (path, kind) => {
    if (!BusinessDirectoryQuerySchema.safeParse({ path }).success) throw pathDenied(path);
    if (process.platform !== 'linux' || !['arm64', 'x64'].includes(process.arch)) throw new RunnerCommandError('unsupported_capability', '当前 Runner 不支持原子工作区文件读取');
    const canonical = await realpath(root), target = await realpath(`${canonical}/${path}`);
    assertPublicPath(canonical, target, path);
    const rootFd = openSync(canonical, O_PATH | O_CLOEXEC | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    let fd = -1;
    try {
      const name = Buffer.from(`${relative(canonical, target) || '.'}\0`);
      const how = new BigUint64Array([BigInt(O_PATH | O_CLOEXEC), 0n, BigInt(RESOLVE_BENEATH | RESOLVE_NO_MAGICLINKS)]);
      const native = (linux ??= loadLinux()).symbols;
      fd = native.syscall(437, rootFd, ptr(name), ptr(how), how.byteLength);
      if (fd < 0) {
        if ([38, 22, 7].includes(read.i32(native.__errno_location()!))) throw new RunnerCommandError('unsupported_capability', '内核不支持原子工作区文件读取');
        throw pathDenied(path);
      }
      const descriptorPath = `/proc/self/fd/${fd}`;
      assertPublicPath(canonical, await realpath(descriptorPath), path);
      const info = fstatSync(fd);
      if (kind === 'file' ? !info.isFile() : !info.isDirectory()) throw new RunnerCommandError('invalid_file_type', '只允许读取普通文件或目录');
      const pinned = fd;
      let closed = false;
      fd = -1;
      return { descriptorPath, fd: pinned, close: () => { if (!closed) { closed = true; closeSync(pinned); } } };
    } finally { if (fd >= 0) closeSync(fd); closeSync(rootFd); }
  };
}

function assertPublicPath(root: string, target: string, original: string): void {
  if (!isInside(root, target) || relative(root, target).split('/').includes('.crewstation')) throw pathDenied(original);
}
