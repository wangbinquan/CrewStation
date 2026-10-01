import type { Logger } from '@crewstation/kernel';
import type { PeriodicJob } from '@crewstation/resource-runtime';
import { periodicJob } from '@crewstation/resource-runtime';

/** 身份索引墓碑清理的节奏：启动后先跑一次，此后每小时一次（保留期 7 天，差一小时无妨）。 */
export function identityTombstoneWorker(purge: () => Promise<number>, logger: Logger, everyMs = 3_600_000): PeriodicJob {
  return periodicJob(async () => {
    const purged = await purge();
    if (purged) logger.info('pod identity tombstones purged', { purged });
  }, (error) => logger.warn('pod identity tombstone purge failed', { error: String(error) }), everyMs);
}

/** 原回调停止恢复独立于连接、事件租约及普通身份墓碑保留期。 */
export function gatewayProcessRecoveryWorker(recover: () => Promise<void>, logger: Logger, everyMs = 5_000): PeriodicJob {
  return periodicJob(recover, () => logger.warn('original gateway process recovery unavailable'), everyMs);
}
