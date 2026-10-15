// RFC-034 v2 展示口径（与 agent-workflow RFC-371 v2 一致）：未知不是 0、不完整是下界、未定价不显示为 ¥0；地址里的筛选只认合法值。
import { expect, test } from 'bun:test';
import { callLanes } from '../features/observability/components/RuntimeCallLanes';
import { callCostText, callTokenText, compactCount, durationText, modelCostText, usageCostText } from '../features/observability/model/runtimeFormat';
import { observationWindow, parseRuntimeSearch, runtimeTabs } from '../features/observability/model/runtimeSearch';
import { ASOF, runtimeStatisticsFixture, usageOf } from './runtimeStatisticsFixture';

const t = (key: string) => key;

test('aggregate CNY: hidden is a dash, only-unpriced is unpriced, incomplete or partly unpriced is a lower bound', () => {
  expect(usageCostText(usageOf({ costNano: null }), t)).toBe('—');
  expect(usageCostText(usageOf({ unpricedCalls: 2, costNano: '0' }), t)).toBe('runtime.unpriced');
  expect(usageCostText(usageOf({ unpricedCalls: 1 }), t)).toBe('≥ ¥2.50');
  expect(usageCostText(usageOf({ incompleteCalls: 1 }), t)).toBe('≥ ¥2.50');
  expect(usageCostText(usageOf(), t)).toBe('¥2.50');
  expect(usageCostText(usageOf({ costNano: '999' }), t)).toBe('< ¥0.000001');
  expect(usageCostText(usageOf({ calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, costNano: '0' }), t)).toBe('¥0.00');
});

test('a run without a snapshot shows unknown tokens and CNY; partial usage and partial pricing are lower bounds', () => {
  const run = { usageState: 'complete' as const, costState: 'priced' as const, costNano: '1500000' };
  expect(callTokenText({ ...run, usageState: 'pending' }, 0)).toBe('—');
  expect(callTokenText({ ...run, usageState: 'none' }, 0)).toBe('—');
  expect(callTokenText({ ...run, usageState: 'partial' }, 1200)).toBe('≥ 1,200');
  expect(callTokenText(run, 1200)).toBe('1,200');
  expect(callCostText({ ...run, usageState: 'none' }, true, t)).toBe('—');
  expect(callCostText(run, false, t)).toBe('—');
  expect(callCostText({ ...run, costState: 'unpriced', costNano: '0' }, true, t)).toBe('runtime.unpriced');
  expect(callCostText({ ...run, costState: 'partial' }, true, t)).toBe('≥ ¥0.0015');
  expect(callCostText(run, true, t)).toBe('¥0.0015');
  expect(modelCostText(null, true, t)).toBe('runtime.unpriced');
  expect(modelCostText('1500000', false, t)).toBe('—');
});

test('durations and compact bar labels', () => {
  expect([durationText(null), durationText(850), durationText(42_000), durationText(610_000), durationText(5_400_000)]).toEqual(['—', '850 ms', '42.0 s', '10.2 min', '1.5 h']);
  expect([compactCount(999), compactCount(1_200), compactCount(3_400_000), compactCount(2_000_000_000)]).toEqual(['999', '1.2K', '3.4M', '2B']);
});

test('the address keeps only known tabs, periods and sources, and a resource range only when ordered', () => {
  expect(parseRuntimeSearch({ tab: 'usage', period: 'year', source: 'cli', q: '  修复 ' })).toEqual({ q: '修复' });
  expect(parseRuntimeSearch({ tab: 'platform', period: 'month', source: 'development' })).toEqual({ tab: 'platform', period: 'month', source: 'development' });
  expect(parseRuntimeSearch({ from: '2026-10-14T00:00:00Z', to: '2026-10-13T00:00:00Z' })).toEqual({});
  expect(parseRuntimeSearch({ from: '2026-10-13T00:00:00Z', to: '2026-10-14T00:00:00Z' })).toEqual({ from: '2026-10-13T00:00:00.000Z', to: '2026-10-14T00:00:00.000Z' });
  expect(runtimeTabs({ kind: 'project', projectId: 'p', space: 'workbench' })).toEqual(['overview', 'tasks', 'agents', 'resources', 'health']);
});

test('windows end at the read time and carry the browser offset', () => {
  const now = Date.parse(ASOF);
  for (const [period, days] of [['day', 1], ['week', 7], ['month', 30]] as const) {
    const window = observationWindow(period, now);
    expect(window.to).toBe(ASOF);
    expect(Date.parse(window.to) - Date.parse(window.from)).toBe(days * 86_400_000);
    expect(window.tzOffset).toBe(-new Date(now).getTimezoneOffset());
  }
});

test('lanes group retries of one Agent on one row in order of first start', () => {
  const original = globalThis.fetch;
  try {
    const lanes = callLanes([...runtimeStatisticsFixture().calls].reverse());
    expect(lanes.map((lane) => [lane.key, lane.calls.map((call) => call.id)])).toEqual([['coder', ['call-1', 'call-2']], ['reviewer', ['call-3']]]);
  } finally { globalThis.fetch = original; }
});
