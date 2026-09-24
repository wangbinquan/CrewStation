import type { Logger } from '@crewstation/kernel';
import type { PeriodicJob } from '@crewstation/resource-runtime';
import { periodicJob } from '@crewstation/resource-runtime';

/** 数据资源与访问绑定的补投影：启动后先跑一次（部署时已有的库与绑定进台账），此后每 5 分钟一次。 */
export function dataLedgerResyncWorker(resync: () => Promise<number>, logger: Logger, everyMs = 300_000): PeriodicJob {
  return periodicJob(async () => {
    const synced = await resync();
    logger.debug('resource ledger data resynced', { synced });
  }, (error) => logger.warn('resource ledger data resync failed', { error: String(error) }), everyMs);
}
