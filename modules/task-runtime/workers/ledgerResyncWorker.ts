import type { Logger } from '@crewstation/kernel';
import type { PeriodicJob } from '@crewstation/resource-runtime';
import { periodicJob } from '@crewstation/resource-runtime';

/** 台账补投影的节奏：启动后先跑一次（部署时已有的会话进台账），此后每 5 分钟一次。 */
export function ledgerResyncWorker(resync: () => Promise<number>, logger: Logger, everyMs = 300_000): PeriodicJob {
  return periodicJob(async () => {
    const synced = await resync();
    if (synced) logger.info('resource ledger resynced', { synced });
  }, (error) => logger.warn('resource ledger resync failed', { error: String(error) }), everyMs);
}
