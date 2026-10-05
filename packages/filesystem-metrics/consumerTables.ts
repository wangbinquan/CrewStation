import { dlopen, FFIType } from 'bun:ffi';

/** Equality is supplied by the kernel, never inferred from identical FD
 * numbers or a thread name. Unsupported/denied comparisons use full scans. */
export function nativeConsumerTables(root: string) {
  const nr = process.arch === 'arm64' ? 272n : process.arch === 'x64' ? 312n : undefined;
  if (process.platform !== 'linux' || root !== '/proc' || nr === undefined) return undefined;
  let library: ReturnType<typeof open>;
  try { library = open(); } catch { return undefined; }
  return { shared: (pid: string, tid: string) => ({ files: library.symbols.syscall(nr, Number(pid), Number(tid), 2, 0n, 0n) === 0n,
    fs: library.symbols.syscall(nr, Number(pid), Number(tid), 3, 0n, 0n) === 0n }), close: () => library.close() };
}
function open() {
  return dlopen('libc.so.6', { syscall: { args: [FFIType.i64, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.u64, FFIType.u64], returns: FFIType.i64 } });
}
