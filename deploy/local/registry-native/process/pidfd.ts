import { dlopen, FFIType } from 'bun:ffi';
import { readFile } from 'node:fs/promises';
import type { RegistryProcessIdentity } from './identity';

export interface RegistryPidfd { assertAlive(): Promise<void>; signal(value: 'stop' | 'continue'): Promise<void>; close(): void }
/** A process reference opened once and retained by the private host. Neither
 * process.kill(PID) nor a request PID is used, including the finally resume. */
export async function openRegistryPidfd(original: RegistryProcessIdentity): Promise<RegistryPidfd> {
  if (process.platform !== 'linux') throw Error('Registry pidfd requires the original Linux node');
  const library = dlopen('libc.so.6', { pidfd_open: { args: [FFIType.i32, FFIType.u32], returns: FFIType.i32 },
    pidfd_send_signal: { args: [FFIType.i32, FFIType.i32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 }, close: { args: [FFIType.i32], returns: FFIType.i32 } });
  const fd = library.symbols.pidfd_open(original.pid, 0); let active = fd >= 0;
  const check = async () => {
    if (!active || library.symbols.pidfd_send_signal(fd, 0, null, 0) !== 0 || !new RegExp('^Pid:\\s+' + original.pid + '$', 'm').test(await readFile('/proc/self/fdinfo/' + fd, 'utf8'))) throw Error('Original Registry pidfd has exited');
  };
  try { await check(); } catch (error) { if (active) library.symbols.close(fd); library.close(); throw error; }
  return { assertAlive: check, signal: async value => { await check(); if (library.symbols.pidfd_send_signal(fd, value === 'stop' ? 19 : 18, null, 0) !== 0) throw Error('Original Registry pidfd signal failed'); },
    close: () => { if (!active) return; active = false; library.symbols.close(fd); library.close(); } };
}
