import { dlopen, FFIType } from 'bun:ffi';
import { readFile } from 'node:fs/promises';
import { RegistryProcessIdentitySchema, inspectOriginalRegistryProcess, processStat } from './identity';
import type { RegistryProcessIdentity } from './identity';
import { openRegistryPidfd } from './pidfd';
import { guardianFrame } from './guardianFrame';

export interface RegistryPauseGuardian { readonly signal: AbortSignal; disarm(): Promise<void> }
/** This separate process keeps its own original pidfd. It resumes the
 * Registry only after the operator has exited, or after its actual finally
 * explicitly disarms it. A deadline must kill the operator before resuming. */
export async function startRegistryPauseGuardian(original: RegistryProcessIdentity, entry = Bun.main): Promise<RegistryPauseGuardian> {
  const parent = processStat(await readFile('/proc/self/stat', 'utf8'), String(process.pid));
  const child = Bun.spawn([process.execPath, entry, '--registry-pause-guardian'], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  const controller = new AbortController(); let disarming = false;
  void child.exited.then(() => { if (!disarming) controller.abort(Error('Original Registry pause guardian exited')); });
  child.stdin.write(JSON.stringify({ original, parentPid: process.pid, parentStart: parent.startTicks }) + '\n'); child.stdin.flush();
  const reader = child.stdout.getReader();
  try {
    const ready = await guardianFrame(reader, 6, AbortSignal.timeout(2000));
    if (ready !== 'ready' || child.exitCode !== null) throw Error('Original Registry guardian was not established');
  } catch (error) { child.kill('SIGKILL'); await child.exited; throw error; }
  finally { reader.releaseLock(); }
  return { signal: controller.signal, disarm: async () => {
    if (controller.signal.aborted || disarming) throw Error('Original Registry guardian cannot be disarmed');
    disarming = true; child.stdin.write('done\n'); child.stdin.end();
    if (await child.exited !== 0) throw Error('Original Registry guardian did not confirm disarm');
  } };
}

export async function runRegistryPauseGuardian() {
  const reader = Bun.stdin.stream().getReader();
  const first = await guardianFrame(reader, 65_536, AbortSignal.timeout(2000)); if (!first) throw Error('Registry guardian origin is absent');
  const raw = JSON.parse(first) as { original: unknown; parentPid: unknown; parentStart: unknown }, original = RegistryProcessIdentitySchema.parse(raw.original);
  if (!Number.isSafeInteger(raw.parentPid) || Number(raw.parentPid) <= 0 || !/^[1-9][0-9]*$/.test(String(raw.parentStart))) throw Error('Registry guardian operator origin is invalid');
  const pid = Number(raw.parentPid), stat = () => readFile('/proc/' + pid + '/stat', 'utf8');
  if (processStat(await stat(), String(pid)).startTicks !== raw.parentStart) throw Error('Registry guardian operator birth changed');
  const library = dlopen('libc.so.6', { pidfd_open: { args: [FFIType.i32, FFIType.u32], returns: FFIType.i32 },
    pidfd_send_signal: { args: [FFIType.i32, FFIType.i32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 }, close: { args: [FFIType.i32], returns: FFIType.i32 } });
  const parentFd = library.symbols.pidfd_open(pid, 0), fd = await openRegistryPidfd(original);
  try {
    if (parentFd < 0 || processStat(await stat(), String(pid)).startTicks !== raw.parentStart
      || JSON.stringify(await inspectOriginalRegistryProcess(original)) !== JSON.stringify(original)) throw Error('Registry guardian original operator or Registry changed');
    await fd.assertAlive(); process.stdout.write('ready\n');
    let state: string | undefined;
    try { state = await guardianFrame(reader, 5, AbortSignal.timeout(25_000)); } catch { state = undefined; }
    if (state === 'done') return;
    await resumeAfterOperatorExit({ alive: async () => library.symbols.pidfd_send_signal(parentFd, 0, null, 0) === 0,
      kill: async () => { if (library.symbols.pidfd_send_signal(parentFd, 9, null, 0) !== 0 && library.symbols.pidfd_send_signal(parentFd, 0, null, 0) === 0) throw Error('Registry guardian could not stop its original operator'); },
      resume: () => fd.signal('continue') });
  } finally { reader.releaseLock(); fd.close(); if (parentFd >= 0) library.symbols.close(parentFd); library.close(); }
}

export async function resumeAfterOperatorExit(input: { alive(): Promise<boolean>; kill(): Promise<void>; resume(): Promise<void> }, wait = () => new Promise<void>(resolve => setTimeout(resolve, 10))) {
  if (await input.alive()) await input.kill();
  while (await input.alive()) await wait();
  await input.resume();
}
