/**
 * RFC-024：CLI 界面是否已画出。进程拉起不等于能用——OpenCode 要先起内部服务、取初始快照才建渲染器，
 * 150m CPU 下拉起后约 9 秒才第一次输出。判据只看屏幕：出现可见文字，且此后静止一段时间（画完一帧、停下等输入）。
 * 终端查询（DA、DSR、DECRQM、OSC 4/10/11）由终端解析、不落到屏幕上，所以只看可见文字，不看有没有字节。
 * 纯状态机：不持有计时器，调用方按 `nextTickAt` 排下一次 tick。
 */
export interface ReadinessLimits {
  /** 最后一次输出后静止多久算画完。 */
  readonly quietMs: number;
  /** 进程拉起后多久仍未判定就放行，免得判据失灵时把人挡在门外。 */
  readonly timeoutMs: number;
  /** 屏幕上至少多少个非空白字符才算有界面。 */
  readonly minVisible: number;
}

export const DEFAULT_READINESS_LIMITS: ReadinessLimits = { quietMs: 500, timeoutMs: 90_000, minVisible: 1 };

export type ReadinessVerdict = 'screen' | 'timeout';

export interface ReadinessState {
  readonly spawnedAt: number;
  readonly lastOutputAt?: number;
  readonly visible: number;
  readonly done?: ReadinessVerdict;
}

export type ReadinessInput =
  | { readonly kind: 'output'; readonly at: number; readonly visibleChars: number }
  | { readonly kind: 'tick'; readonly at: number };

export interface ReadinessStep {
  readonly state: ReadinessState;
  /** 下一次该 tick 的时刻；已判定时没有。 */
  readonly nextTickAt?: number;
}

export function startReadiness(spawnedAt: number, limits: ReadinessLimits = DEFAULT_READINESS_LIMITS): ReadinessStep {
  const state: ReadinessState = { spawnedAt, visible: 0 };
  return { state, nextTickAt: nextTick(state, limits) };
}

export function stepReadiness(state: ReadinessState, input: ReadinessInput, limits: ReadinessLimits = DEFAULT_READINESS_LIMITS): ReadinessStep {
  if (state.done) return { state };
  const next: ReadinessState = input.kind === 'output' ? { ...state, lastOutputAt: input.at, visible: input.visibleChars } : state;
  const done = verdict(next, input.at, limits);
  if (done) return { state: { ...next, done } };
  return { state: next, nextTickAt: nextTick(next, limits) };
}

function verdict(state: ReadinessState, now: number, limits: ReadinessLimits): ReadinessVerdict | undefined {
  if (state.visible >= limits.minVisible && state.lastOutputAt !== undefined && now - state.lastOutputAt >= limits.quietMs) return 'screen';
  if (now - state.spawnedAt >= limits.timeoutMs) return 'timeout';
  return undefined;
}

function nextTick(state: ReadinessState, limits: ReadinessLimits): number {
  const timeout = state.spawnedAt + limits.timeoutMs;
  if (state.visible >= limits.minVisible && state.lastOutputAt !== undefined) return Math.min(state.lastOutputAt + limits.quietMs, timeout);
  return timeout;
}
