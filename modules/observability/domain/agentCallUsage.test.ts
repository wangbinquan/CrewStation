// RFC-034 v2 §3–§4：一次执行的用量是可整份替换的按模型快照；未知不是 0，取消 / 中断的完整快照只是下界。
import { expect, test } from 'bun:test';
import { finalUsageOf, normalizeObservedUsage, sumBuckets, totalTokens, usageStateOf } from './agentCallUsage';

const row = (model: string, input: number, output: number, reasoning = 0) => ({ model, input, cacheRead: 1, cacheWrite: 2, output, reasoning });

test('duplicate model keys merge, illegal counts drop to zero and reasoning never exceeds output', () => {
  const usage = normalizeObservedUsage({ state: 'complete', models: [row(' b ', 10, 4, 9), row('b', 5, 1, 1), row('a', -3, Number.NaN, 2), row('a', 1.5, 2, 0)] });
  expect(usage).toEqual({ state: 'complete', models: [
    { model: 'a', input: 0, cacheRead: 2, cacheWrite: 4, output: 2, reasoning: 0 },
    { model: 'b', input: 15, cacheRead: 2, cacheWrite: 4, output: 5, reasoning: 5 },
  ] });
  expect(normalizeObservedUsage({ state: 'partial', models: Array.from({ length: 120 }, (_, i) => row(`m${String(i).padStart(3, '0')}`, 1, 1)) }).models).toHaveLength(100);
});

test('stored usage state: complete stays, an empty report is pending while running and none once ended', () => {
  expect(usageStateOf({ state: 'complete', models: [] }, false)).toBe('complete');
  expect(usageStateOf({ state: 'partial', models: [] }, false)).toBe('pending');
  expect(usageStateOf(null, true)).toBe('none');
  expect(usageStateOf({ state: 'partial', models: [row('a', 1, 1)] }, true)).toBe('partial');
});

test('canceled or interrupted complete snapshots become lower bounds; done and failed keep them', () => {
  const complete = { state: 'complete' as const, models: [row('a', 1, 1)] };
  expect(finalUsageOf(complete, 'canceled').state).toBe('partial');
  expect(finalUsageOf(complete, 'interrupted').state).toBe('partial');
  expect(finalUsageOf(complete, 'done').state).toBe('complete');
  expect(finalUsageOf(complete, 'failed').state).toBe('complete');
});

test('four disjoint buckets add up; reasoning is a subset of output', () => {
  const sum = sumBuckets([row('a', 10, 4, 3), row('b', 5, 6, 1)]);
  expect(sum).toEqual({ input: 15, cacheRead: 2, cacheWrite: 4, output: 10, reasoning: 4 });
  expect(totalTokens(sum)).toBe(31);
});
