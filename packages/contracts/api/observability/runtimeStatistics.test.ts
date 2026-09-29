// RFC-034: project/system statistics preserve exact CNY, field visibility and explicit missing evidence.
import { expect, test } from 'bun:test';
import { RuntimeStatisticsQuerySchema, RuntimeUsageMetricsSchema, ProjectRuntimeStatisticsSchema, SystemRuntimeStatisticsSchema, RuntimeTaskFactSchema } from './runtimeStatistics';
const id = '01a0bf5d-8f4b-7000-9e4b-b54e91ee9d10';
const window = { from: '2026-09-28T00:00:00.000Z', to: '2026-09-29T00:00:00.000Z', timezone: 'Asia/Shanghai' };
const metrics = { tokens: { input: '90071992547409930001', cacheRead: '0', cacheWrite: '0', output: '0', total: '90071992547409930001', hasKnown: true, complete: true, unknownBuckets: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 } },
  cost: { currency: 'CNY', amount: '0', complete: true, visible: true }, executions: 1, observedExecutions: 1, records: 1, reasons: [], partial: false };
const common = { asOf: window.to, projectionVersion: 1, cohort: 'started', filters: window, partial: false, limits: { tasks: 200, attempts: 2000, records: 20000 },
  metrics, tasks: [], agents: [], projects: [], profiles: [], trend: [], durations: { samples: 0, p50Ms: null, p95Ms: null, maxMs: null }, quality: [], sourceScope: 'business-tasks' };

test('statistics query rejects reversed, empty and unknown-timezone windows', () => {
  expect(RuntimeStatisticsQuerySchema.parse(window)).toEqual(window);
  for (const patch of [{ to: window.from }, { from: window.to, to: window.from }, { timezone: 'unknown' }, { projectId: id }])
    expect(RuntimeStatisticsQuerySchema.safeParse({ ...window, ...patch }).success).toBe(false);
});
test('exact counts, zero, pico-yuan and absent amounts remain distinct', () => {
  expect(RuntimeUsageMetricsSchema.parse(metrics).tokens.total).toBe('90071992547409930001');
  expect(RuntimeUsageMetricsSchema.parse(metrics).cost.amount).toBe('0');
  expect(RuntimeUsageMetricsSchema.parse({ ...metrics, cost: { ...metrics.cost, amount: '1.000000000001' } }).cost.amount).toBe('1.000000000001');
  expect(RuntimeUsageMetricsSchema.parse({ ...metrics, cost: { currency: 'CNY', amount: null, complete: false, visible: false } }).cost.amount).toBeNull();
  for (const cost of [{ ...metrics.cost, currency: 'USD' }, { ...metrics.cost, visible: false }, { ...metrics.cost, amount: '1e-6' }])
    expect(RuntimeUsageMetricsSchema.safeParse({ ...metrics, cost }).success).toBe(false);
});
test('project and system DTOs have distinct fields even when read by the same administrator', () => {
  expect(ProjectRuntimeStatisticsSchema.safeParse({ ...common, scope: 'project', projectId: id }).success).toBe(true);
  expect(SystemRuntimeStatisticsSchema.safeParse({ ...common, scope: 'system', models: [], profiles: [] }).success).toBe(true);
  expect(ProjectRuntimeStatisticsSchema.safeParse({ ...common, scope: 'project', projectId: id, models: [] }).success).toBe(false);
  expect(SystemRuntimeStatisticsSchema.safeParse({ ...common, scope: 'project', projectId: id }).success).toBe(false);
});
test('owner task facts keep unknown timing explicit and reject extra execution payload fields', () => {
  const task = { id, projectId: id, serviceId: id, name: 'Business task', protocol: 'v3', state: 'running', createdAt: window.from, closedAt: null, traceId: null,
    attempts: [{ id, taskId: id, name: 'Agent', kind: 'agent', state: 'pending', attempt: 1, executionId: id, agentId: null, profileId: null, profileRevision: null, createdAt: window.from, startedAt: null, endedAt: null }], attemptsPartial: false };
  expect(RuntimeTaskFactSchema.parse(task).attempts[0]?.startedAt).toBeNull();
  expect(RuntimeTaskFactSchema.safeParse({ ...task, command: ['unexpected'] }).success).toBe(false);
});

test('unknown output remains distinct from a known zero with incomplete coverage', () => {
  const tokens = { ...metrics.tokens, input: '10', total: '10', complete: false };
  const zero = RuntimeUsageMetricsSchema.parse({ ...metrics, tokens });
  const unknown = RuntimeUsageMetricsSchema.parse({ ...metrics, tokens: { ...tokens, unknownBuckets: { ...tokens.unknownBuckets, output: 1 } } });
  expect(zero.tokens.total).toBe(unknown.tokens.total);
  expect(zero.tokens.output).toBe('0');
  expect(zero.tokens.unknownBuckets.output).toBe(0);
  expect(unknown.tokens.unknownBuckets.output).toBe(1);
  expect(RuntimeUsageMetricsSchema.safeParse({ ...metrics, tokens: { ...tokens, unknownBuckets: { ...tokens.unknownBuckets, output: -1 } } }).success).toBe(false);
});
