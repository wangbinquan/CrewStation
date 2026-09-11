import type { Subprocess } from 'bun';

export const DEFAULT_KILL_GRACE_MS = 5000;

export function isAlive(proc: Subprocess): boolean {
  return proc.exitCode === null && proc.signalCode === null;
}

export type TreeSignal = 'SIGTERM' | 'SIGKILL' | 'SIGHUP';

/**
 * 杀整棵进程树：先向进程组发 `firstSignal`（缺省 SIGTERM；交互式 shell 忽略 SIGTERM，终端用 SIGHUP），宽限后 SIGKILL。
 * 子进程一律以 `detached: true`（setsid）或 PTY 会话组长方式拉起，因此 `kill(-pid)` 覆盖它派生的全部后代；
 * 进程组不存在时退回只杀该进程。
 */
export async function killProcessTree(proc: Subprocess, graceMs = DEFAULT_KILL_GRACE_MS, firstSignal: TreeSignal = 'SIGTERM'): Promise<void> {
  if (!isAlive(proc)) return;
  signalTree(proc, firstSignal);
  if (await exitedWithin(proc, graceMs)) return;
  signalTree(proc, 'SIGKILL');
  await exitedWithin(proc, 2000);
}

export function signalTree(proc: Subprocess, signal: TreeSignal): void {
  try {
    process.kill(-proc.pid, signal);
  } catch {
    try {
      proc.kill(signal);
    } catch {
      // 进程已经不存在
    }
  }
}

async function exitedWithin(proc: Subprocess, ms: number): Promise<boolean> {
  return Promise.race([proc.exited.then(() => true), Bun.sleep(ms).then(() => false)]);
}
