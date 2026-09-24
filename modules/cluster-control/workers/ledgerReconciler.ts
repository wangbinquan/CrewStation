import type { Logger } from '@crewstation/kernel';
import type { LeasePort } from '@crewstation/resource-runtime';
import { createWorkQueue, withLease } from '@crewstation/resource-runtime';
import type { ManagedObjectFeed } from '../ports/cluster';
import type { LedgerObservations } from '../ports/ledger';

export interface LedgerReconcilerOptions {
  readonly pollMs?: number;
  readonly resyncMs?: number;
  readonly concurrency?: number;
  /** 路由等中间件时的复核间隔（用例调短）。 */
  readonly retryMs?: number;
  /** 多副本分工（设计 §6.3）：处理一条记录前抢它的租约；不给就不分工（单副本、用例）。 */
  readonly leases?: ReplicaLeases;
}

/** 多副本分工的租约：持有者是这个副本（`<进程名>-<主机名>.cluster-control`），持有期 30 秒，处理中续约。 */
export interface ReplicaLeases {
  readonly port: LeasePort;
  readonly holder: string;
  readonly ttlMs?: number;
  /** 抢不到（另一副本正在处理，读的可能是旧版本）时隔多久再排一次；缺省 5 秒。 */
  readonly retryMs?: number;
}

const LEASE_TTL_MS = 30_000;
const LEASE_RETRY_MS = 5_000;

/**
 * 调和器的工作队列（设计 §6.1）：键是资源 ID，同一资源在队列里只有一项。触发来源：台账变更（尾随变更日志）、
 * 观测缓存同步完成后的一次全量、此后每 10 分钟一次全量核对。处理函数每次都读最新的记录与观测缓存。
 * 多副本时每条记录在租约下处理（设计 §6.3）：抢不到说明另一副本正在处理它——那一轮读到的可能是这次变化之前的版本，
 * 所以过几秒再排一次，而不是丢掉。持有者崩溃，租约 30 秒后过期，下一次核对由别的副本接手。
 */
export function ledgerReconciler(ledger: LedgerObservations, feed: ManagedObjectFeed, reconcile: (id: string, enqueue: (id: string, afterMs?: number) => void) => Promise<void>, logger: Logger, options: LedgerReconcilerOptions = {}) {
  const leases = options.leases;
  const process = async (id: string, enqueue: (id: string, afterMs?: number) => void): Promise<void> => {
    if (!leases) return reconcile(id, enqueue);
    const outcome = await withLease(leases.port, id, leases.holder, leases.ttlMs ?? LEASE_TTL_MS, () => reconcile(id, enqueue));
    if (!outcome.acquired) enqueue(id, leases.retryMs ?? LEASE_RETRY_MS);
  };
  // 处理一条记录时可以把相关记录（例如上级结束后的工作卷）再排进同一个去重队列，或约一个到期复核（例如崩溃重启的窗口过去之后）。
  const queue: ReturnType<typeof createWorkQueue> = createWorkQueue((id) => process(id, (next, afterMs) => (afterMs ? queue.addAfter(next, afterMs) : queue.add(next))), { logger, concurrency: options.concurrency ?? 4 });
  let running = false, synced = false;
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
        synced = true;
        cursor = await ledger.latestChange().catch(() => undefined);
        await resync();
        void tail();
        resyncTimer = setInterval(() => void resync(), options.resyncMs ?? 600_000);
      });
    },
    /** 观测到调和器渲染的对象有变化时直接排进来（改标签、改额度上限不变 generation，台账不记变更）；同步完成之前的忽略——首轮全量会处理。 */
    enqueue: (id: string) => { if (running && synced) queue.add(id); },
    stop: async () => {
      running = false;
      if (tailTimer) clearTimeout(tailTimer);
      if (resyncTimer) clearInterval(resyncTimer);
      await queue.stop();
    },
    drained: () => queue.drained(),
  };
}
