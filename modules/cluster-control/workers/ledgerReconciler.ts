import type { Logger } from '@crewstation/kernel';
import { createWorkQueue } from '@crewstation/resource-runtime';
import type { ManagedObjectFeed } from '../ports/cluster';
import type { LedgerObservations } from '../ports/ledger';

export interface LedgerReconcilerOptions {
  readonly pollMs?: number;
  readonly resyncMs?: number;
  readonly concurrency?: number;
}

/**
 * 调和器的工作队列（设计 §6.1）：键是资源 ID，同一资源在队列里只有一项。触发来源：台账变更（尾随变更日志）、
 * 观测缓存同步完成后的一次全量、此后每 10 分钟一次全量核对。处理函数每次都读最新的记录与观测缓存。
 */
export function ledgerReconciler(ledger: LedgerObservations, feed: ManagedObjectFeed, reconcile: (id: string, enqueue: (id: string) => void) => Promise<void>, logger: Logger, options: LedgerReconcilerOptions = {}) {
  // 处理一条记录时可以把相关记录（例如上级结束后的工作卷）再排进同一个去重队列。
  const queue: ReturnType<typeof createWorkQueue> = createWorkQueue((id) => reconcile(id, (next) => queue.add(next)), { logger, concurrency: options.concurrency ?? 4 });
  let running = false;
  let cursor: number | undefined;
  let tailTimer: ReturnType<typeof setTimeout> | undefined;
  let resyncTimer: ReturnType<typeof setInterval> | undefined;

  const resync = async () => {
    try { for (const record of await ledger.listLive()) queue.add(record.id); } catch (error) { logger.warn('resource reconcile resync failed', { error: String(error) }); }
  };
  const tail = async () => {
    tailTimer = undefined;
    if (!running) return;
    let delay = options.pollMs ?? 1_000;
    try {
      cursor ??= await ledger.latestChange();
      const batch = await ledger.changesSince(cursor, 500);
      for (const entry of batch) queue.add(entry.resourceId);
      if (batch.length) cursor = batch.at(-1)!.seq;
      if (batch.length === 500) delay = 0;
    } catch (error) {
      logger.warn('resource reconcile tail failed', { error: String(error) });
      delay = 5_000;
    }
    if (running) tailTimer = setTimeout(() => void tail(), delay);
  };

  return {
    start: () => {
      if (running) return;
      running = true;
      queue.start();
      void feed.synced().then(async () => {
        if (!running) return;
        cursor = await ledger.latestChange().catch(() => undefined);
        await resync();
        void tail();
        resyncTimer = setInterval(() => void resync(), options.resyncMs ?? 600_000);
      });
    },
    stop: async () => {
      running = false;
      if (tailTimer) clearTimeout(tailTimer);
      if (resyncTimer) clearInterval(resyncTimer);
      await queue.stop();
    },
    drained: () => queue.drained(),
  };
}
