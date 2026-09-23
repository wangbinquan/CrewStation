import { describe, expect, test } from 'bun:test';
import { noopLogger } from '@crewstation/kernel';
import { abortableSleep, backoffDelay } from './backoff';
import { withLease } from './lease';
import { createWorkQueue } from './workQueue';

describe('退避', () => {
  test('指数增长并封顶；第 0 次不等', () => {
    expect([0, 1, 2, 3, 10].map((n) => backoffDelay(n, 1_000, 5_000))).toEqual([0, 1_000, 2_000, 4_000, 5_000]);
  });

  test('等待可以被中止', async () => {
    const controller = new AbortController();
    const started = Date.now();
    const waiting = abortableSleep(10_000, controller.signal);
    controller.abort();
    await waiting;
    expect(Date.now() - started).toBeLessThan(1_000);
    await abortableSleep(10_000, controller.signal);
  });
});

describe('按资源 ID 去重的工作队列（RFC-025 设计 §6.1）', () => {
  test('同一个键在队列里只有一项；处理中又来的，处理完再来一遍', async () => {
    const seen: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const queue = createWorkQueue(async (key) => { seen.push(key); if (key === 'a' && seen.length === 1) await gate; }, { logger: noopLogger, concurrency: 1 });
    queue.start();
    queue.add('a');
    queue.add('a');
    queue.add('b');
    queue.add('b');
    expect(queue.size()).toBe(2);
    queue.add('a');
    release();
    await queue.drained();
    expect(seen).toEqual(['a', 'b', 'a']);
    await queue.stop();
  });

  test('并发上限内并行处理不同的键', async () => {
    let active = 0, peak = 0;
    const queue = createWorkQueue(async () => { active += 1; peak = Math.max(peak, active); await Bun.sleep(20); active -= 1; }, { logger: noopLogger, concurrency: 2 });
    queue.start();
    for (const key of ['a', 'b', 'c', 'd']) queue.add(key);
    await queue.drained();
    expect(peak).toBe(2);
    await queue.stop();
  });

  test('失败按退避重试并报失败次数；成功一次清零', async () => {
    const failures: number[] = [];
    let calls = 0;
    const queue = createWorkQueue(async () => { calls += 1; if (calls < 3) throw new Error('集群暂时不可用'); }, { logger: noopLogger, backoff: { initialMs: 10, maxMs: 40 }, onFailure: (_key, _error, attempts) => failures.push(attempts) });
    queue.start();
    queue.add('r1');
    const deadline = Date.now() + 2_000;
    while (calls < 3 && Date.now() < deadline) await Bun.sleep(5);
    await queue.drained();
    expect(calls).toBe(3);
    expect(failures).toEqual([1, 2]);
    expect(queue.failures('r1')).toBe(0);
    await queue.stop();
  });

  test('延迟排队只保留最早的一次；停止后不再处理，并等在处理中的结束', async () => {
    const seen: string[] = [];
    const queue = createWorkQueue(async (key) => { seen.push(key); await Bun.sleep(30); }, { logger: noopLogger });
    queue.start();
    queue.addAfter('late', 10_000);
    queue.addAfter('late', 20);
    queue.addAfter('late', 5_000);
    await Bun.sleep(60);
    expect(seen).toEqual(['late']);
    queue.add('x');
    await queue.stop();
    expect(seen).toEqual(['late', 'x']);
    queue.add('y');
    await Bun.sleep(20);
    expect(seen).toEqual(['late', 'x']);
  });
});

describe('租约（设计 §6.3）', () => {
  const fakeLeases = () => {
    const holders = new Map<string, string>();
    let renewOk = true;
    return {
      holders, setRenew: (ok: boolean) => { renewOk = ok; },
      acquire: async (id: string, holder: string) => { const current = holders.get(id); if (current && current !== holder) return false; holders.set(id, holder); return true; },
      renew: async () => renewOk,
      release: async (id: string, holder: string) => { if (holders.get(id) === holder) holders.delete(id); },
    };
  };

  test('抢不到就跳过；抢到了处理完释放', async () => {
    const leases = fakeLeases();
    leases.holders.set('r1', 'b');
    expect(await withLease(leases, 'r1', 'a', 30_000, async () => 'done')).toEqual({ acquired: false });
    expect(await withLease(leases, 'r2', 'a', 30_000, async () => 'done')).toEqual({ acquired: true, value: 'done' });
    expect(leases.holders.has('r2')).toBe(false);
  });

  test('续约失败（被别的副本接手）时中止信号', async () => {
    const leases = fakeLeases();
    leases.setRenew(false);
    const outcome = await withLease(leases, 'r3', 'a', 60, async (signal) => {
      const deadline = Date.now() + 1_000;
      while (!signal.aborted && Date.now() < deadline) await Bun.sleep(5);
      return signal.aborted;
    });
    expect(outcome).toEqual({ acquired: true, value: true });
  });
});
