import type { Logger } from '@crewstation/kernel';
import type { PeriodicJob } from '@crewstation/resource-runtime';
import { periodicJob } from '@crewstation/resource-runtime';

/** 限流策略补投影的节奏：启动后先跑一次（部署时已有的策略进台账），此后每 5 分钟一次。 */
export function rateLimitLedgerResyncWorker(resync: () => Promise<number>, logger: Logger, everyMs = 300_000): PeriodicJob {
  return periodicJob(async () => {
    const synced = await resync();
    if (synced) logger.info('resource ledger rate limits resynced', { synced });
  }, (error) => logger.warn('resource ledger rate limit resync failed', { error: String(error) }), everyMs);
}
