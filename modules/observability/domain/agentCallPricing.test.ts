// RFC-034 v2 §3.3：只追加的价格线按执行开始冻结；整数纳元计价；未定价桶让成本成为部分，不是 0。
import { expect, test } from 'bun:test';
import type { PriceVersion } from './agentCallPricing';
import { callCostState, modelCost, selectPrice } from './agentCallPricing';

const version = (id: string, effectiveFrom: number, createdAt: number, rates: Partial<Record<'inputMicro' | 'cacheReadMicro' | 'cacheWriteMicro' | 'outputMicro', number | null>> = {}): PriceVersion => ({
  id, profileId: 'p', model: 'm', inputMicro: 2_000_000, cacheReadMicro: 500_000, cacheWriteMicro: null, outputMicro: 8_000_000, effectiveFrom, createdAt, createdBy: 'u', note: '', ...rates,
});
const usage = (input: number, cacheRead = 0, cacheWrite = 0, output = 0) => ({ input, cacheRead, cacheWrite, output, reasoning: 0 });

test('a run uses the latest version effective and created by its start; backdating never reprices started runs', () => {
  const older = version('a', 100, 100), newer = version('b', 200, 200), backdated = version('c', 150, 400);
  expect(selectPrice([older, newer, backdated], 300)?.id).toBe('b');
  expect(selectPrice([older, newer, backdated], 500)?.id).toBe('b');
  expect(selectPrice([older, backdated], 500)?.id).toBe('c');
  expect(selectPrice([older, newer], 150)?.id).toBe('a');
  expect(selectPrice([newer], 150)).toBeNull();
  expect(selectPrice([version('x', 100, 100), version('y', 100, 100)], 200)?.id).toBe('y');
});

test('cost is exact integer nano-yuan with half-up rounding', () => {
  expect(modelCost(usage(1234), version('a', 0, 0))).toEqual({ costNano: 2_468_000n, complete: true });
  expect(modelCost(usage(1), version('a', 0, 0, { inputMicro: 499 }))).toEqual({ costNano: 0n, complete: true });
  expect(modelCost(usage(1), version('a', 0, 0, { inputMicro: 500 }))).toEqual({ costNano: 1n, complete: true });
  expect(modelCost(usage(10, 0, 0, 0), version('a', 0, 0, { inputMicro: 0 }))).toEqual({ costNano: 0n, complete: true });
});

test('unknown rates with tokens make the cost partial; nothing priced is unpriced; no price at all is null', () => {
  expect(modelCost(usage(1000, 0, 10, 0), version('a', 0, 0))).toEqual({ costNano: 2_000_000n, complete: false });
  expect(modelCost(usage(0, 0, 10, 0), version('a', 0, 0))).toEqual({ costNano: null, complete: false });
  expect(modelCost(usage(1000), null)).toEqual({ costNano: null, complete: false });
});

test('a run is none without tokens, priced, partial or unpriced from its model rows', () => {
  const priced = { tokens: 10, cost: { costNano: 5n, complete: true } }, unknown = { tokens: 10, cost: { costNano: null, complete: false } };
  expect(callCostState([])).toEqual({ costNano: 0n, costState: 'none' });
  expect(callCostState([{ tokens: 0, cost: { costNano: null, complete: false } }])).toEqual({ costNano: 0n, costState: 'none' });
  expect(callCostState([priced, priced])).toEqual({ costNano: 10n, costState: 'priced' });
  expect(callCostState([priced, unknown])).toEqual({ costNano: 5n, costState: 'partial' });
  expect(callCostState([unknown])).toEqual({ costNano: 0n, costState: 'unpriced' });
});
