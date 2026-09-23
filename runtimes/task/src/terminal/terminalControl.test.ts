import { expect, test } from 'bun:test';
import type { TerminalControlState } from '@crewstation/contracts';
import type { TerminalControlClock } from './terminalControl';
import { createTerminalControl, TERMINAL_CONTROL_LEASE_MS } from './terminalControl';

/** 假时钟：推进时间时按到期先后执行已排的定时，取消的不再执行。 */
function fakeClock() {
  let time = 100_000;
  let timers: Array<{ at: number; run: () => void }> = [];
  const clock: TerminalControlClock = {
    now: () => time,
    schedule: (ms, run) => { const timer = { at: time + ms, run }; timers.push(timer); return () => { timers = timers.filter((t) => t !== timer); }; },
  };
  const advance = (ms: number) => {
    time += ms;
    for (let due = timers.filter((t) => t.at <= time); due.length > 0; due = timers.filter((t) => t.at <= time)) {
      timers = timers.filter((t) => !due.includes(t));
      for (const timer of due) timer.run();
    }
  };
  return { clock, advance, pending: () => timers.length };
}

const zhang = { userId: 'user-zhang', name: '张三' }, li = { userId: 'user-li', name: '李四' };

function recorded() {
  const f = fakeClock(), changes: TerminalControlState[] = [];
  return { ...f, changes, lease: createTerminalControl((state) => changes.push(state), f.clock) };
}

test('多个视图只有一个输入／尺寸控制，错误视图 detach 不抢控制，断线租约到期可重新取得', () => {
  const { lease, advance } = recorded();
  expect(lease.claim('one').controlled).toBe(true);
  expect(lease.claim('two').controlled).toBe(false);
  expect(() => lease.assert('two')).toThrow('未取得');
  lease.release('two');
  lease.assert('one');
  advance(TERMINAL_CONTROL_LEASE_MS);
  expect(() => lease.assert('one')).toThrow('未取得');
  expect(lease.claim('two').controlled).toBe(true);
  lease.release('two');
  expect(lease.claim('one').controlled).toBe(true);
});

test('被别人占着时回持有人，查看者据此显示「谁正在输入」', () => {
  const { lease } = recorded();
  expect(lease.claim('view-zhang', zhang)).toMatchObject({ controlled: true, control: { held: true, holder: zhang, revision: 1 } });
  expect(lease.claim('view-li', li)).toMatchObject({ controlled: false, control: { held: true, holder: zhang, revision: 1 } });
  expect(() => lease.assert('view-li')).toThrow('未取得');
});

test('占用只对别人成立：同一用户的另一视图来取直接转过去，原视图随即不能输入', () => {
  const { lease, changes } = recorded();
  lease.claim('tab-one', zhang);
  expect(lease.claim('tab-two', zhang)).toMatchObject({ controlled: true, control: { holder: zhang, revision: 2 } });
  expect(() => lease.assert('tab-one')).toThrow('未取得');
  lease.assert('tab-two');
  expect(changes.map((c) => c.revision)).toEqual([1, 2]);
});

test('持有人不变的续约不推送；换人、释放、到期各推一次且序号递增', () => {
  const { lease, changes, advance } = recorded();
  lease.claim('view-zhang', zhang);
  lease.claim('view-zhang', zhang);
  lease.assert('view-zhang');
  expect(changes).toEqual([{ held: true, holder: zhang, revision: 1 }]);
  lease.release('view-zhang');
  lease.claim('view-li', li);
  advance(TERMINAL_CONTROL_LEASE_MS);
  expect(changes).toEqual([
    { held: true, holder: zhang, revision: 1 },
    { held: false, revision: 2 },
    { held: true, holder: li, revision: 3 },
    { held: false, revision: 4 },
  ]);
  expect(lease.state()).toEqual({ held: false, revision: 4 });
});

// 焦点离开终端后浏览器不再续约：没人再来取时，Runner 也必须自己把「已空闲」推出去，否则别人一直看到早已离开的持有人。
test('无人再操作时租约到点主动释放并推送；续约与输入会把到期时间往后推', () => {
  const { lease, changes, advance, pending } = recorded();
  lease.claim('view-zhang', zhang);
  advance(TERMINAL_CONTROL_LEASE_MS - 1);
  lease.assert('view-zhang');
  advance(TERMINAL_CONTROL_LEASE_MS - 1);
  lease.claim('view-zhang', zhang);
  advance(TERMINAL_CONTROL_LEASE_MS - 1);
  expect(changes).toHaveLength(1);
  advance(1);
  expect(changes.at(-1)).toEqual({ held: false, revision: 2 });
  expect(pending()).toBe(0);
});

test('旧 cs-session 不带持有人：照常互斥，不转移，状态里没有持有人', () => {
  const { lease } = recorded();
  expect(lease.claim('one')).toMatchObject({ controlled: true, control: { held: true, revision: 1 } });
  expect(lease.claim('two', zhang)).toMatchObject({ controlled: false, control: { held: true, revision: 1 } });
  expect(lease.state().holder).toBeUndefined();
});

test('进程结束后停掉到期定时，不再推送', () => {
  const { lease, changes, advance, pending } = recorded();
  lease.claim('view-zhang', zhang);
  lease.dispose();
  expect(pending()).toBe(0);
  advance(TERMINAL_CONTROL_LEASE_MS * 2);
  expect(changes).toHaveLength(1);
});
