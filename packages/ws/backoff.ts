/** 指数退避参数；`jitter` 为 0–1 的比例，表示围绕名义值上下抖动的幅度。 */
export interface BackoffPolicy {
  baseMs: number;
  maxMs: number;
  factor: number;
  jitter: number;
}

export const DEFAULT_BACKOFF: BackoffPolicy = { baseMs: 500, maxMs: 30_000, factor: 2, jitter: 0.3 };

/**
 * 第 `attempt` 次（从 0 起）重试前应等待的毫秒数：`base × factor^attempt` 截断到 `maxMs`，再按 `jitter` 抖动。
 * `random` 可注入以便测试；结果恒在 `[0, maxMs]` 内。
 */
export function backoffDelayMs(attempt: number, policy: BackoffPolicy = DEFAULT_BACKOFF, random: () => number = Math.random): number {
  const nominal = Math.min(policy.maxMs, policy.baseMs * policy.factor ** Math.max(0, attempt));
  const spread = nominal * Math.min(1, Math.max(0, policy.jitter));
  const jittered = nominal - spread + random() * 2 * spread;
  return Math.round(Math.min(policy.maxMs, Math.max(0, jittered)));
}
