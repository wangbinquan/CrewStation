// RFC-034: exact known subtotals, native parent coverage and valuations must agree.
import { expect, test } from 'bun:test';
import { ExecutionUsageObservationSchema, ExecutionValuationObservationSchema } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { aggregateRuntimeMetrics, runtimeUsageMetrics } from './cnyPricing';
import { selectRuntimeUsage } from './tokenUsage';
const identity = { projectId: newResourceId(), taskId: newResourceId(), subtaskId: newResourceId(), executionId: newResourceId(), executionGeneration: 1 };
const at = '2026-09-28T12:00:00.000Z';
const usage = (patch: Record<string, unknown> = {}) => ExecutionUsageObservationSchema.parse({ kind: 'usage', identity, sourceId: 'runner', recordId: 'a', revision: 1, occurredAt: at, observedAt: at,
  adapterVersion: 'test', modelRef: null, reporting: 'delta', inclusion: 'self', coverage: 'complete', validity: 'valid', scope: null, coveredThroughTurn: null,
  usage: { input: '10', cacheRead: '0', cacheWrite: '0', output: '0' }, basis: { kind: 'invocation' },
  projection: { projectionRevision: 1, observedRevision: 1, contribution: { input: '10', cacheRead: '0', cacheWrite: '0', output: '0' }, coveredThrough: null, complete: true, issues: [] }, ...patch });
const valuation = (row = usage(), patch: Record<string, unknown> = {}) => ExecutionValuationObservationSchema.parse({ kind: 'valuation', identity: row.identity, sourceId: row.sourceId, recordId: row.recordId,
  revision: 1, valuationId: row.recordId, valuationRevision: 1, usageRevision: row.projection.projectionRevision, occurredAt: at, observedAt: at,
  currency: 'CNY', availability: 'priced', amountDecimal: '0.000000000001', priceVersionRef: 'price-1', completeness: 'complete', ...patch });
test('exact large counts and pico yuan sum without floating-point loss; known zero is not missing', () => {
  const base = usage(), large = usage({ projection: { ...base.projection, contribution: { ...base.projection.contribution, input: '90071992547409930001' } } });
  const m = runtimeUsageMetrics([large, valuation(large)], true, 1);
  expect(m.tokens.total).toBe('90071992547409930001'); expect(m.cost.amount).toBe('0.000000000001'); expect(m.tokens.complete).toBe(true);
  expect(aggregateRuntimeMetrics([m, m]).tokens.total).toBe('180143985094819860002'); expect(aggregateRuntimeMetrics([m, m]).cost.amount).toBe('0.000000000002');
  expect(runtimeUsageMetrics([base, valuation(base, { amountDecimal: '0' })], true, 1).cost.amount).toBe('0');
  const missing = runtimeUsageMetrics([], true, 1); expect(missing.tokens.hasKnown).toBe(false); expect(missing.tokens.unknownBuckets.output).toBe(1); expect(missing.cost.amount).toBeNull();
});
test('unknown buckets, partial coverage, hidden amounts, stale revisions and commands retain their meanings', () => {
  const base = usage(), partial = usage({ projection: { ...base.projection, complete: false, contribution: { ...base.projection.contribution, output: null } } });
  const m = runtimeUsageMetrics([partial, valuation(partial, { completeness: 'partial' })], true, 1);
  expect(m.tokens.unknownBuckets.output).toBe(1); expect(m.tokens.total).toBe('10'); expect(m.reasons).toContain('usage-partial');
  expect(runtimeUsageMetrics([base, valuation(base)], false, 1).cost).toEqual({ currency: 'CNY', visible: false, amount: null, complete: false });
  expect(runtimeUsageMetrics([base, valuation(base, { usageRevision: 2 })], true, 1).reasons).toContain('valuation-pending');
  expect(runtimeUsageMetrics([], true, 0).reasons).toContain('not-applicable');
});
test('tree totals cover native children only through their own model and bucket watermarks', () => {
  const base = usage(), scope = { root: 'root', session: 'root', parentSession: null, ancestors: [], turn: '1', turnIndex: 0, level: 'tree-total' };
  const root = usage({ recordId: 'root', inclusion: 'includes-descendants', scope, coveredThroughTurn: 4,
    projection: { ...base.projection, contribution: { input: '100', output: null, cacheRead: '0', cacheWrite: '0' }, complete: false, coveredThrough: { input: 4, output: null, cacheRead: 4, cacheWrite: 4 } } });
  const child = usage({ recordId: 'child', scope: { ...scope, session: 'child', parentSession: 'root', ancestors: ['root'], level: 'request', turnIndex: 2 },
    projection: { ...base.projection, contribution: { input: '20', output: '5', cacheRead: '0', cacheWrite: '0' }, coveredThrough: { input: 2, output: 2, cacheRead: 2, cacheWrite: 2 } } });
  const m = runtimeUsageMetrics([root, child, valuation(root), valuation(child)], true, 1);
  expect(m.tokens.input).toBe('100'); expect(m.tokens.output).toBe('5'); expect(m.tokens.total).toBe('105'); expect(m.tokens.complete).toBe(false);
  expect(m.reasons).toContain('valuation-overlap'); expect(m.cost.amount).toBe('0.000000000001');
  const other = usage({ ...child, recordId: 'other-model', modelRef: 'other', scope: { ...child.scope!, turnIndex: 6 }, projection: { ...child.projection, coveredThrough: { input: 6, output: 6, cacheRead: 6, cacheWrite: 6 } } });
  expect(runtimeUsageMetrics([root, child, other], true, 1).tokens.total).toBe('130');
});
test('ambiguous overlap is bounded below, source/generation are separate and inconsistent ancestry fails', () => {
  const base = usage(), scope = { root: 'root', session: 'root', parentSession: null, ancestors: [], turn: '1', turnIndex: 0, level: 'tree-total' };
  const first = usage({ scope, inclusion: 'includes-descendants', coveredThroughTurn: 4, projection: { ...base.projection, coveredThrough: { input: 4, output: 4, cacheRead: 4, cacheWrite: 4 } } });
  const overlap = usage({ ...first, recordId: 'overlap', scope: { ...scope, turnIndex: 3 }, coveredThroughTurn: 8, projection: { ...first.projection, coveredThrough: { input: 8, output: 8, cacheRead: 8, cacheWrite: 8 } } });
  expect(runtimeUsageMetrics([first, overlap], true, 1).reasons).toContain('coverage-overlap');
  expect(runtimeUsageMetrics([first, { ...first, identity: { ...first.identity, executionGeneration: 2 } }], true, 2).tokens.total).toBe('20');
  expect(runtimeUsageMetrics([first, { ...first, sourceId: 'second' }], true, 1).tokens.total).toBe('20');
  const child = usage({ ...first, recordId: 'child', scope: { ...scope, session: 'child', parentSession: 'root', ancestors: ['root'] } });
  const bad = usage({ ...first, recordId: 'bad', scope: { ...scope, session: 'child', parentSession: 'middle', ancestors: ['root', 'middle'] } });
  expect(selectRuntimeUsage([child, bad])).toMatchObject({ selected: [], conflicts: 1, incomplete: true });
  const conflict = runtimeUsageMetrics([child, bad, base], true, 1);
  expect(conflict.tokens.total).toBe('10'); expect(conflict.tokens.complete).toBe(false); expect(conflict.tokens.unknownBuckets.input).toBe(1); expect(conflict.reasons).toContain('coverage-conflict');
});
