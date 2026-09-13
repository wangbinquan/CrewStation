import { RunnerCommandError } from '../commandError';

export const TERMINAL_CONTROL_LEASE_MS = 30_000;

/** 只有持有控制的视图可输入／改尺寸；detach 与超时只释放控制，不结束进程。 */
export function createTerminalControl(now: () => number = Date.now) {
  let lease: { viewId: string; until: number } | undefined;
  const current = () => {
    if (lease && lease.until <= now()) lease = undefined;
    return lease;
  };
  return {
    claim(viewId: string) {
      const held = current();
      if (held && held.viewId !== viewId) return { controlled: false, expiresAt: new Date(held.until).toISOString() };
      lease = { viewId, until: now() + TERMINAL_CONTROL_LEASE_MS };
      return { controlled: true, expiresAt: new Date(lease.until).toISOString() };
    },
    assert(viewId: string | undefined) {
      const held = current();
      if (!viewId || !held || held.viewId !== viewId) throw new RunnerCommandError('terminal_read_only', '当前视图未取得此终端的输入控制');
      held.until = now() + TERMINAL_CONTROL_LEASE_MS;
    },
    release(viewId: string) { if (current()?.viewId === viewId) lease = undefined; },
  };
}
