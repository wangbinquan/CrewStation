/** 指数退避：第 n 次失败等 initial × 2^(n−1)，封顶 max（设计 §6.1：调和失败上限 5 分钟）。 */
export function backoffDelay(attempt: number, initialMs: number, maxMs: number): number {
  if (attempt <= 0) return 0;
  return Math.min(maxMs, initialMs * 2 ** Math.min(attempt - 1, 30));
}

/** 可中止的等待：停机时不必等完整个退避。 */
export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); }
    signal.addEventListener('abort', done, { once: true });
  });
}
