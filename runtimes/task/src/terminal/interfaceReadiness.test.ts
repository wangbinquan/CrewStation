import { expect, test } from 'bun:test';
import type { ReadinessStep } from './interfaceReadiness';
import { DEFAULT_READINESS_LIMITS, startReadiness, stepReadiness } from './interfaceReadiness';

// RFC-024：步骤条曾在进程拉起那一刻撤掉，OpenCode 还要十来秒才画出界面，用户看到一块不动的黑屏。
// 这些用例锁住「画出界面」的判据：可见文字＋静止 500 ms；只有终端查询不算；90 秒超时放行。
// 超时原为 45 秒，实机 OpenCode 在 150m CPU 下 43.2 秒才画出界面、几乎撞上超时（RFC-024 验收 §3），作者裁定放大到 90 秒。

const output = (step: ReadinessStep, at: number, visibleChars: number) => stepReadiness(step.state, { kind: 'output', at, visibleChars });
const tick = (step: ReadinessStep, at: number) => stepReadiness(step.state, { kind: 'tick', at });

test('默认判据：静止 500 ms、超时 90 秒、至少一个可见字符', () => {
  expect(DEFAULT_READINESS_LIMITS).toEqual({ quietMs: 500, timeoutMs: 90_000, minVisible: 1 });
});

test('拉起后还没有输出：下一次 tick 在超时时刻', () => {
  const start = startReadiness(1_000);
  expect(start.state.done).toBeUndefined();
  expect(start.nextTickAt).toBe(91_000);
});

test('出现可见文字并静止 500 ms 判为画出界面', () => {
  let step = output(startReadiness(0), 9_000, 800);
  expect(step.nextTickAt).toBe(9_500);
  step = tick(step, 9_499);
  expect(step.state.done).toBeUndefined();
  step = tick(step, 9_500);
  expect(step.state.done).toBe('screen');
  expect(step.nextTickAt).toBeUndefined();
});

test('静止期内又有输出：顺延到最后一次输出之后 500 ms', () => {
  let step = output(startReadiness(0), 9_000, 10);
  step = output(step, 9_300, 900);
  expect(step.nextTickAt).toBe(9_800);
  expect(tick(step, 9_600).state.done).toBeUndefined();
  expect(tick(step, 9_800).state.done).toBe('screen');
});

test('只有终端查询（屏幕上没有可见文字）不判完成，到 90 秒按超时放行', () => {
  let step = output(startReadiness(0), 9_000, 0);
  expect(step.nextTickAt).toBe(90_000);
  // 实机 OpenCode 43.2 秒才画出界面：旧的 45 秒超时在这之后不久就会放行，现在仍在等。
  step = tick(step, 45_000);
  expect(step.state.done).toBeUndefined();
  step = tick(step, 90_000);
  expect(step.state.done).toBe('timeout');
});

test('界面一直在刷新、从不静止：仍在 90 秒超时放行，排的 tick 不越过超时时刻', () => {
  let step = startReadiness(0);
  for (let at = 89_000; at < 90_000; at += 100) step = output(step, at, 50);
  expect(step.nextTickAt).toBe(90_000);
  expect(tick(step, 90_000).state.done).toBe('timeout');
});

test('输出到达时已满足静止条件，当场判定（例如迟到的计时器之前先来了一帧）', () => {
  const step = output(startReadiness(0), 90_000, 5);
  expect(step.state.done).toBe('timeout');
});

test('判定之后忽略一切输入', () => {
  const done = tick(output(startReadiness(0), 9_000, 800), 9_500);
  expect(output(done, 9_600, 0).state).toEqual(done.state);
  expect(tick(done, 50_000).state.done).toBe('screen');
});

test('可调判据：最少可见字符数没达到时不判画出', () => {
  const limits = { quietMs: 200, timeoutMs: 10_000, minVisible: 5 };
  let step = stepReadiness(startReadiness(0, limits).state, { kind: 'output', at: 1_000, visibleChars: 3 }, limits);
  expect(step.nextTickAt).toBe(10_000);
  step = stepReadiness(step.state, { kind: 'output', at: 1_100, visibleChars: 5 }, limits);
  expect(stepReadiness(step.state, { kind: 'tick', at: 1_300 }, limits).state.done).toBe('screen');
});
