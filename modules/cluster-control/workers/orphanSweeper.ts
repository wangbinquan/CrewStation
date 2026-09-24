import type { Logger } from '@crewstation/kernel';
import { withLease } from '@crewstation/resource-runtime';
import type { SweepResult } from '../application/orphanSweep';
import type { ManagedObjectFeed } from '../ports/cluster';
import type { ReplicaLeases } from './ledgerReconciler';

/** 孤儿回收整轮持的作业租约：同一时刻只有一个副本在扫，另一个副本这一轮跳过。 */
export const ORPHAN_SWEEP_LEASE = 'cluster-control:orphan-sweep';

export interface OrphanSweeperOptions {
  /** 观测缓存同步完成后先等这么久再做第一轮（让补投影与按记录核对先把台账补齐）。 */
  readonly firstDelayMs?: number;
  readonly everyMs?: number;
  /** 多副本时整轮在作业租约下跑（持有期按一轮的上限给足：5 分钟，处理中续约）。 */
  readonly leases?: ReplicaLeases;
}

/**
 * 孤儿回收的节奏（设计 §6.4）：观测缓存同步完成、再等 10 分钟后做第一轮，此后每 10 分钟一轮；同一时刻只跑一轮。
 * 有删除或登记的轮次记一行汇总，失败只记告警、下一轮再来。
 */
export function orphanSweeper(feed: ManagedObjectFeed, sweep: () => Promise<SweepResult>, logger: Logger, options: OrphanSweeperOptions = {}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let active: Promise<void> | undefined;
  const leased = async (): Promise<SweepResult | undefined> => {
    if (!options.leases) return sweep();
    const outcome = await withLease(options.leases.port, ORPHAN_SWEEP_LEASE, options.leases.holder, 300_000, () => sweep());
    return outcome.acquired ? outcome.value : undefined;
  };
  const once = (): Promise<void> => {
    active ??= leased()
      .then((result) => { if (result && (result.removed || result.volumes)) logger.info('resource orphan sweep', { ...result }); })
      .catch((error: unknown) => logger.warn('resource orphan sweep failed', { error: String(error) }))
      .finally(() => { active = undefined; });
    return active;
  };
  const schedule = (delay: number) => {
    timer = setTimeout(() => { void once().finally(() => { if (running) schedule(options.everyMs ?? 600_000); }); }, delay);
  };
  return {
    start: () => {
      if (running) return;
      running = true;
      void feed.synced().then(() => { if (running) schedule(options.firstDelayMs ?? 600_000); });
    },
    stop: async () => {
      running = false;
      if (timer) clearTimeout(timer);
      timer = undefined;
      await active;
    },
  };
}
