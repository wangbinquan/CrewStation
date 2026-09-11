import { describe, expect, test } from 'bun:test';
import { createHeartbeat, createIdleWatchdog } from './heartbeat';
import { ReplayBuffer } from './replayBuffer';

describe('ReplayBuffer', () => {
  test('push 严格递增，since 返回 seq 更大的条目，容量有界', () => {
    const buffer = new ReplayBuffer<string>(3);
    buffer.push(1, 'a');
    buffer.push(2, 'b');
    expect(() => buffer.push(2, 'dup')).toThrow(RangeError);
    buffer.push(3, 'c');
    buffer.push(4, 'd');
    expect(buffer.size).toBe(3);
    expect(buffer.firstSeq).toBe(2);
    expect(buffer.lastSeq).toBe(4);
    expect(buffer.since(0).map((e) => e.item)).toEqual(['b', 'c', 'd']);
    expect(buffer.since(2).map((e) => e.seq)).toEqual([3, 4]);
    expect(buffer.since(4)).toEqual([]);
    expect(buffer.since(99)).toEqual([]);
  });
  test('drop 丢弃已确认的条目，canReplayFrom 识别淘汰造成的缺口', () => {
    const buffer = new ReplayBuffer<number>(10);
    for (let seq = 1; seq <= 5; seq += 1) buffer.push(seq, seq * 10);
    expect(buffer.drop(3)).toBe(2);
    expect(buffer.firstSeq).toBe(3);
    expect(buffer.canReplayFrom(2)).toBe(true);
    expect(buffer.canReplayFrom(1)).toBe(false);
    expect(buffer.canReplayFrom(5)).toBe(true);
    expect(new ReplayBuffer<number>(1).canReplayFrom(0)).toBe(true);
    expect(() => new ReplayBuffer<number>(0)).toThrow(RangeError);
  });
  test('seq 可以不连续（发送端可能跳号）', () => {
    const buffer = new ReplayBuffer<string>(5);
    buffer.push(10, 'x');
    buffer.push(20, 'y');
    expect(buffer.since(10).map((e) => e.item)).toEqual(['y']);
    expect(buffer.since(15).map((e) => e.item)).toEqual(['y']);
  });
});

describe('心跳', () => {
  test('主动侧：未收到 pong 超时触发 onTimeout 并停止；收到 pong 则持续', async () => {
    let pings = 0;
    let timedOut = 0;
    const alive = createHeartbeat({ intervalMs: 10, timeoutMs: 40, sendPing: () => { pings += 1; alive.pong(); }, onTimeout: () => { timedOut += 1; } });
    alive.start();
    await Bun.sleep(80);
    alive.stop();
    expect(pings).toBeGreaterThanOrEqual(3);
    expect(timedOut).toBe(0);
    expect(alive.running).toBe(false);

    let deadPings = 0;
    let deadTimeouts = 0;
    const dead = createHeartbeat({ intervalMs: 10, timeoutMs: 30, sendPing: () => { deadPings += 1; }, onTimeout: () => { deadTimeouts += 1; } });
    dead.start();
    await Bun.sleep(100);
    expect(deadPings).toBe(1);
    expect(deadTimeouts).toBe(1);
    expect(dead.running).toBe(false);
  });
  test('被动侧看门狗：touch 续期，静默超时触发', async () => {
    let fired = 0;
    const watchdog = createIdleWatchdog({ timeoutMs: 40, onTimeout: () => { fired += 1; } });
    watchdog.start();
    for (let i = 0; i < 4; i += 1) {
      await Bun.sleep(15);
      watchdog.touch();
    }
    expect(fired).toBe(0);
    await Bun.sleep(70);
    expect(fired).toBe(1);
    watchdog.touch();
    await Bun.sleep(60);
    expect(fired).toBe(1);
    watchdog.stop();
  });
});
