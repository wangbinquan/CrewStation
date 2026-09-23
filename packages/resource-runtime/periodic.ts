export interface PeriodicJob {
  start(): void;
  /** 停下节拍，并等正在跑的那一轮结束。 */
  stop(): Promise<void>;
}

/**
 * 定时作业（补投影、墓碑清理这类定期全量的活）：启动后先跑一次，此后按周期；上一轮没跑完时这一拍跳过，同一时刻只跑一轮；
 * 失败交给 onError，不打断节奏。重复启动不叠加。
 */
export function periodicJob(run: () => Promise<void>, onError: (error: unknown) => void, everyMs: number): PeriodicJob {
  let timer: ReturnType<typeof setInterval> | undefined;
  let running: Promise<void> | undefined;
  const once = () => {
    running ??= run().catch(onError).finally(() => { running = undefined; });
    return running;
  };
  return {
    start: () => { if (timer) return; void once(); timer = setInterval(() => void once(), everyMs); },
    stop: async () => { if (timer) clearInterval(timer); timer = undefined; await running; },
  };
}
