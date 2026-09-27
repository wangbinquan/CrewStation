import type { Logger } from '@crewstation/kernel';

/** 控制器生命周期追踪正在执行的一轮，stop 等待它结束；不会重叠启动同一个 worker。 */
export function executionWorker(runOnce: () => Promise<number>, logger: Logger) {
  let timer: ReturnType<typeof setInterval> | undefined, running: Promise<void> | undefined;
  const tick = () => {
    running ??= runOnce().then(() => undefined).catch(() => { logger.error('business execution recovery failed'); }).finally(() => { running = undefined; });
  };
  return {
    start: () => { if (timer) return; tick(); timer = setInterval(tick, 1000); },
    stop: async () => { if (timer) clearInterval(timer); timer = undefined; await running; },
  };
}
