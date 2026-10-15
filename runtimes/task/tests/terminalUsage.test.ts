// RFC-034 v2 §4：「＋ CLI」终端没有结构化输出，Runner 周期采样原生来源，快照变化才上报（整份替换）；
// 退出时再采一次作为最终快照，读不到时保留上一份，从来没有用量时没有最终快照（未知，不是 0）。
import { expect, test } from 'bun:test';
import type { AgentUsageSnapshot } from '@crewstation/contracts';
import { TerminalUsageReporter } from '../src/terminal/terminalUsage';

const request = (sequence: number, input: number) => ({ type: 'api-request' as const, sessionId: 's-1', sequence, model: 'claude-sonnet', input, output: 3, cacheRead: 0, cacheWrite: 0 });

test('samples report only changed snapshots and the final snapshot keeps the latest known usage', () => {
  const reported: AgentUsageSnapshot[] = [];
  const reporter = new TerminalUsageReporter('claude-code', (usage) => reported.push(usage));
  expect(reporter.sample()).toBe(false);
  reporter.meter.observeRequest(request(1, 10));
  expect(reporter.sample()).toBe(true);
  expect(reporter.sample()).toBe(false);
  reporter.meter.observeRequest(request(1, 10));
  reporter.meter.observeRequest(request(2, 5));
  expect(reporter.sample()).toBe(true);
  expect(reported.map((usage) => usage.models[0]!.input)).toEqual([10, 15]);
  reporter.meter.degrade();
  expect(reporter.finish()).toEqual({ state: 'partial', models: [{ model: 'claude-sonnet', input: 15, cacheRead: 0, cacheWrite: 0, output: 6, reasoning: 0 }] });
});

test('a terminal that never used a model has no final snapshot', () => {
  const reporter = new TerminalUsageReporter('claude-code', () => { throw new Error('nothing to report'); });
  reporter.start({}, 60_000);
  expect(reporter.finish()).toBeUndefined();
});

test('an unreadable OpenCode store keeps the previous snapshot instead of reporting zero', () => {
  const reported: AgentUsageSnapshot[] = [];
  const reporter = new TerminalUsageReporter('opencode', (usage) => reported.push(usage));
  reporter.start({ OPENCODE_DB: ':memory:' }, 60_000);
  expect(reporter.sample()).toBe(false);
  expect(reporter.finish()).toBeUndefined();
  expect(reported).toEqual([]);
});
