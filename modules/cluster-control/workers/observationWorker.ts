import type { Logger } from '@crewstation/kernel';
import type { ObservationStats } from '../application/observeChange';
import type { ManagedObjectFeed, ObjectChange } from '../ports/cluster';

/**
 * 观测工作器（cs-controller）：受管对象的变化逐个写回台账；首次全量完成与此后每 10 分钟记一行汇总，
 * 第一期据此核对观测链路在真实集群上是否通畅（unowned 是还没收编的旧对象）。
 */
export function observationWorker(feed: ManagedObjectFeed, handle: (change: ObjectChange) => Promise<void>, stats: () => ObservationStats, logger: Logger, summaryMs = 600_000) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;
  const summary = (event: string) => logger.info(event, { ...stats() });
  return {
    start: () => {
      if (running) return;
      running = true;
      feed.start(handle);
      void feed.synced().then(() => { if (running) summary('resource observation synced'); });
      timer = setInterval(() => summary('resource observation summary'), summaryMs);
    },
    stop: async () => {
      running = false;
      if (timer) clearInterval(timer);
      timer = undefined;
      await feed.stop();
    },
  };
}
