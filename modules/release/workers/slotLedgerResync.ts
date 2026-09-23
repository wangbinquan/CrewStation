import type { Logger } from '@crewstation/kernel';
import type { PeriodicJob } from '@crewstation/resource-runtime';
import { periodicJob } from '@crewstation/resource-runtime';

/** 服务槽补投影的节奏：启动后先跑一次（部署时已有的槽进台账），此后每 5 分钟一次；同一时刻只跑一轮。 */
export function slotLedgerResyncWorker(resync: () => Promise<number>, logger: Logger, everyMs = 300_000): PeriodicJob {
  return periodicJob(async () => {
    const synced = await resync();
    if (synced) logger.info('resource ledger slots resynced', { synced });
  }, (error) => logger.warn('resource ledger slot resync failed', { error: String(error) }), everyMs);
}
