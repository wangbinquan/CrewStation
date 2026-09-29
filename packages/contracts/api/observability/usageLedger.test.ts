// RFC-034: internal development ownership must never widen the AW business v1 wire contract.
import { expect, test } from 'bun:test';
import { ExecutionObservationIdentitySchema, ExecutionObservationPageSchema, ExecutionUsageObservationSchema, ExecutionValuationObservationSchema } from './executionObservations';
import { DevelopmentUsageIdentitySchema, UsageExecutionIdentitySchema, UsageRecordSchema, UsageValuationSchema } from './usageLedger';

const id = '01a0bf5d-8f4b-7000-9e4b-b54e91ee9d10', at = '2026-09-28T00:00:00Z';
const business = { projectId: id, taskId: id, subtaskId: id, executionId: id, executionGeneration: 1 };
const development = { projectId: id, taskId: id, executionId: id, executionGeneration: 1, agentId: id, sourceKind: 'development-agent' };
const usage = { identity: business, sourceId: 'source', recordId: 'step', revision: 1, occurredAt: at, observedAt: at, kind: 'usage', adapterVersion: 'native/1',
  modelRef: 'actual', reporting: 'delta', inclusion: 'self', coverage: 'complete', validity: 'valid', basis: { kind: 'invocation' },
  scope: { root: 'root', session: 'child', parentSession: 'root', ancestors: ['root'], turn: 'turn', turnIndex: 1, level: 'request' }, coveredThroughTurn: null,
  usage: { input: '10', output: '0', cacheRead: '0', cacheWrite: '0' },
  projection: { projectionRevision: 1, observedRevision: 1, contribution: { input: '10', output: '0', cacheRead: '0', cacheWrite: '0' }, coveredThrough: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 }, complete: true, issues: [] } };
const valuation = { identity: business, sourceId: 'source', recordId: 'step', revision: 1, occurredAt: at, observedAt: at, kind: 'valuation',
  valuationId: 'value', valuationRevision: 1, usageRevision: 1, currency: 'CNY', completeness: 'complete', availability: 'priced', priceVersionRef: 'price', amountDecimal: '0.00002' };

test('business documents retain their exact serialized public v1 representation', () => {
  expect(UsageExecutionIdentitySchema.parse(business)).toEqual(ExecutionObservationIdentitySchema.parse(business));
  expect(UsageRecordSchema.parse(usage)).toEqual(ExecutionUsageObservationSchema.parse(usage));
  expect(UsageValuationSchema.parse(valuation)).toEqual(ExecutionValuationObservationSchema.parse(valuation));
  expect(JSON.stringify(UsageRecordSchema.parse(usage))).toBe(JSON.stringify(ExecutionUsageObservationSchema.parse(usage)));
  expect(JSON.stringify(UsageValuationSchema.parse(valuation))).toBe(JSON.stringify(ExecutionValuationObservationSchema.parse(valuation)));
});
test('development retains actual workspace and Agent identity without a fabricated subtask', () => {
  for (const sourceKind of ['development-agent', 'development-cli']) {
    const identity = { ...development, sourceKind }, record = { ...usage, identity }, value = { ...valuation, identity };
    expect(DevelopmentUsageIdentitySchema.parse(identity) as unknown).toEqual(identity);
    expect(UsageRecordSchema.parse(record).identity as unknown).toEqual(identity);
    expect(UsageValuationSchema.parse(value).identity as unknown).toEqual(identity);
    expect(ExecutionUsageObservationSchema.safeParse(record).success).toBe(false);
    expect(ExecutionValuationObservationSchema.safeParse(value).success).toBe(false);
    const page = { schemaVersion: 1, capability: 'executionObservationsV1', projectId: id, taskId: id, items: [record, value], nextCursor: null,
      persistedThrough: '2', firstAvailableCursor: '0', asOf: at, visibilityRevision: 1, costVisibility: 'project-members-and-services', gaps: [], mode: 'incremental' };
    expect(ExecutionObservationPageSchema.safeParse(page).success).toBe(false);
  }
  for (const identity of [{ ...development, subtaskId: id }, { ...development, sourceKind: 'profile-test' }, { ...development, agentId: 'unknown' }, { ...development, executionGeneration: 0 }, { ...business, sourceKind: 'development-agent' }])
    expect(UsageExecutionIdentitySchema.safeParse(identity).success).toBe(false);
});
test('the internal usage schema inherits scope, model revision and complete-bucket checks', () => {
  const valid = { ...usage, identity: development };
  for (const patch of [
    { scope: { ...usage.scope, ancestors: [] } }, { coveredThroughTurn: 0 },
    { inclusion: 'includes-descendants' }, { projection: { ...usage.projection, coveredThrough: null } },
    { projection: { ...usage.projection, observedRevision: 0 } }, { projection: { ...usage.projection, modelRevision: 2 } },
    { projection: { ...usage.projection, contribution: { ...usage.projection.contribution, input: null } } },
  ]) expect(UsageRecordSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  expect(UsageValuationSchema.safeParse({ ...valuation, identity: development, currency: 'USD' }).success).toBe(false);
  expect(UsageValuationSchema.safeParse({ ...valuation, identity: development, availability: 'unpriced', priceVersionRef: null, amountDecimal: '0' }).success).toBe(false);
});
