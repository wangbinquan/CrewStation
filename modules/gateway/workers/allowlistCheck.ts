import type { Logger } from '@crewstation/kernel';
import type { PeriodicJob } from '@crewstation/resource-runtime';
import { periodicJob } from '@crewstation/resource-runtime';

/** 放行表定时全量核对的节奏（RFC-025 设计 §7.4）：启动后先跑一次，此后每 10 分钟一次；不一致时由核对本身告警并重算。 */
export function allowlistCheckWorker(check: () => Promise<unknown>, logger: Logger, everyMs = 600_000): PeriodicJob {
  return periodicJob(async () => { await check(); }, (error) => logger.warn('allowlist check failed', { error: String(error) }), everyMs);
}
