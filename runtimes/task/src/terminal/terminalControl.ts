import type { TerminalControl, TerminalControlState, TerminalHolder } from '@crewstation/contracts';
import { RunnerCommandError } from '../commandError';

export const TERMINAL_CONTROL_LEASE_MS = 30_000;

/** 租约的时钟与到期定时；测试注入假时钟。 */
export interface TerminalControlClock {
  now(): number;
  /** `run` 在 `ms` 毫秒后执行；返回取消函数。 */
  schedule(ms: number, run: () => void): () => void;
}

const systemClock: TerminalControlClock = {
  now: () => Date.now(),
  schedule: (ms, run) => { const timer = setTimeout(run, Math.max(0, ms)); timer.unref?.(); return () => clearTimeout(timer); },
};

interface Lease { viewId: string; holder?: TerminalHolder; until: number }

/**
 * 只有持有控制的视图可输入／改尺寸；detach 与超时只释放控制，不结束进程。
 * 持有人由 cs-session 按连接身份注入；换人、释放或到期都经 `onChange` 推出，所有查看者实时看到谁在输入。
 * 同一用户的另一视图来取直接转过去——占用只对别人成立（2026-09-23 裁定）。
 */
export function createTerminalControl(onChange: (state: TerminalControlState) => void = () => {}, clock: TerminalControlClock = systemClock) {
  let lease: Lease | undefined;
  let revision = 0;
  let cancelExpiry: (() => void) | undefined;
  const state = (): TerminalControlState => ({ held: lease !== undefined, ...(lease?.holder ? { holder: lease.holder } : {}), revision });
  const changed = () => { revision++; onChange(state()); };
  const clear = () => { cancelExpiry?.(); cancelExpiry = undefined; lease = undefined; };
  const current = () => {
    if (lease && lease.until <= clock.now()) { clear(); changed(); }
    return lease;
  };
  // 到期要主动推一次，否则没人再来取时，查看者会一直看到早已离开的持有人。
  const arm = () => {
    cancelExpiry?.();
    cancelExpiry = lease ? clock.schedule(lease.until - clock.now(), () => { cancelExpiry = undefined; if (current()) arm(); }) : undefined;
  };
  const result = (controlled: boolean, until: number): TerminalControl => ({ controlled, expiresAt: new Date(until).toISOString(), control: state() });
  return {
    claim(viewId: string, holder?: TerminalHolder): TerminalControl {
      const held = current();
      if (held && held.viewId !== viewId && !(holder && held.holder?.userId === holder.userId)) return result(false, held.until);
      const moved = !held || held.viewId !== viewId || held.holder?.userId !== holder?.userId || held.holder?.name !== holder?.name;
      lease = { viewId, ...(holder ? { holder } : {}), until: clock.now() + TERMINAL_CONTROL_LEASE_MS };
      arm();
      if (moved) changed();
      return result(true, lease.until);
    },
    assert(viewId: string | undefined) {
      const held = current();
      if (!viewId || !held || held.viewId !== viewId) throw new RunnerCommandError('terminal_read_only', '当前视图未取得此终端的输入控制');
      held.until = clock.now() + TERMINAL_CONTROL_LEASE_MS;
      arm();
    },
    release(viewId: string) { if (current()?.viewId === viewId) { clear(); changed(); } },
    state: (): TerminalControlState => { current(); return state(); },
    /** 进程结束：停掉到期定时，不再推送。 */
    dispose() { clear(); },
  };
}
