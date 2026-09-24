import { describe, expect, test } from 'bun:test';
import { noopLogger } from '@crewstation/kernel';
import type { LeasePort } from '@crewstation/resource-runtime';
import type { SweepResult } from '../application/orphanSweep';
import type { ManagedObjectFeed } from '../ports/cluster';
import type { LedgerObservations } from '../ports/ledger';
import { ledgerReconciler } from './ledgerReconciler';
import { ORPHAN_SWEEP_LEASE, orphanSweeper } from './orphanSweeper';

/** 假租约：held 里的键被「另一个副本」持有；记下这个副本抢、放的顺序。 */
function fakeLeases(held: Set<string>) {
  const log: string[] = [];
  const port: LeasePort = {
    acquire: async (id, holder) => { log.push(`acquire:${id}:${holder}`); return !held.has(id); },
    renew: async () => true,
    release: async (id) => { log.push(`release:${id}`); },
  };
  return { port, log };
}

const feed = { synced: async () => undefined } as unknown as ManagedObjectFeed;
const ledger = (ids: readonly string[]): LedgerObservations => ({
  listLive: async () => ids.map((id) => ({ id })), latestChange: async () => 0, changesSince: async () => [],
} as unknown as LedgerObservations);

async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!check()) { if (Date.now() > deadline) throw new Error('等待超时'); await Bun.sleep(5); }
}

describe('多副本分工（RFC-025 设计 §6.3）', () => {
  test('逐条调和在租约下：抢到才处理、处理完释放；抢不到（另一副本在处理）隔一会儿再排，放开后由这个副本处理', async () => {
    const held = new Set(['b']);
    const leases = fakeLeases(held);
    const handled: string[] = [];
    const reconciler = ledgerReconciler(ledger(['a', 'b']), feed, async (id) => { handled.push(id); }, noopLogger, { pollMs: 1_000_000, leases: { port: leases.port, holder: 'cs-controller-x.cluster-control', retryMs: 20 } });
    reconciler.start();
    await until(() => handled.includes('a') && leases.log.filter((entry) => entry === 'acquire:b:cs-controller-x.cluster-control').length >= 2);
    expect(handled).toEqual(['a']);
    expect(leases.log).toContain('release:a');
    // 另一副本处理完放开了：再排的那一次由这个副本接手。
    held.delete('b');
    await until(() => handled.includes('b'));
    await reconciler.stop();
    expect(leases.log.filter((entry) => entry.startsWith('release:'))).toEqual(['release:a', 'release:b']);
  });

  test('不给租约（单副本、用例）：不抢不放，照常处理', async () => {
    const handled: string[] = [];
    const reconciler = ledgerReconciler(ledger(['a']), feed, async (id) => { handled.push(id); }, noopLogger, { pollMs: 1_000_000 });
    reconciler.start();
    await until(() => handled.includes('a'));
    await reconciler.stop();
  });

  test('孤儿回收整轮持作业租约：另一副本持有时这一轮跳过；抢到就扫', async () => {
    const empty: SweepResult = { removed: 0, volumes: 0 };
    const held = new Set([ORPHAN_SWEEP_LEASE]);
    const leases = fakeLeases(held);
    let sweeps = 0;
    const sweeper = orphanSweeper(feed, async () => { sweeps += 1; return empty; }, noopLogger, { firstDelayMs: 1, everyMs: 10, leases: { port: leases.port, holder: 'replica-a' } });
    sweeper.start();
    await until(() => leases.log.filter((entry) => entry === `acquire:${ORPHAN_SWEEP_LEASE}:replica-a`).length >= 2);
    expect(sweeps).toBe(0);
    held.clear();
    await until(() => sweeps > 0);
    await sweeper.stop();
    expect(leases.log).toContain(`release:${ORPHAN_SWEEP_LEASE}`);
  });
});
