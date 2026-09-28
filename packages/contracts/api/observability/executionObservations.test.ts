// RFC-034: CS/AW handoff keeps usage and CNY valuations independently revisioned.
import { expect, test } from 'bun:test';
import { ExecutionObservationPageSchema, ExecutionObservationQuerySchema, ExecutionUsageObservationSchema, ExecutionValuationObservationSchema } from './executionObservations';
const id = '01a0bf5d-8f4b-7000-9e4b-b54e91ee9d10', time = '2026-09-28T00:00:00Z';
const identity = { projectId: id, taskId: id, subtaskId: id, executionId: id, executionGeneration: 1 };
const envelope = { identity, sourceId: 'source-1', recordId: 'meter-1', revision: 1, occurredAt: time, observedAt: time };
const usage = { ...envelope, kind: 'usage', adapterVersion: 'claude/1', modelRef: 'public-model-1', reporting: 'cumulative', inclusion: 'self', coverage: 'partial', validity: 'valid',
  projection: { projectionRevision: 1, observedRevision: 1, contribution: { input: '100', output: null, cacheRead: '0', cacheWrite: null }, coveredThrough: null, complete: false, issues: [] },
  scope: null, coveredThroughTurn: null, usage: { input: '100', output: null, cacheRead: '0', cacheWrite: null }, basis: { kind: 'invocation' } };
const valued = { ...envelope, kind: 'valuation', valuationId: 'valuation-1', valuationRevision: 2, usageRevision: 1, currency: 'CNY', completeness: 'partial', availability: 'priced', priceVersionRef: 'version-1', amountDecimal: '0.001234' };
const page = { schemaVersion: 1, capability: 'executionObservationsV1', projectId: id, taskId: id, items: [usage, valued], nextCursor: null,
  persistedThrough: '3', firstAvailableCursor: '0', asOf: time, visibilityRevision: 2, costVisibility: 'project-members-and-services', gaps: [], mode: 'incremental' };

test('精确四桶、未知与显式零保持区别，未知恢复基线不会被默认为零', () => {
  expect(ExecutionUsageObservationSchema.parse(usage).usage).toEqual(usage.usage);
  const restored = ExecutionUsageObservationSchema.parse({ ...usage, basis: { kind: 'native-session', lineageKey: 'native', baseline: null } });
  expect(restored.basis).toEqual({ kind: 'native-session', lineageKey: 'native', baseline: null });
  for (const input of [-1, 1, '1.2', '-2', '01']) expect(ExecutionUsageObservationSchema.safeParse({ ...usage, usage: { ...usage.usage, input } }).success).toBe(false);
  expect(ExecutionUsageObservationSchema.safeParse({ ...usage, usage: { ...usage.usage, input: '9'.repeat(60) } }).success).toBe(true);
});

test('人民币估值修订独立于用量修订，未定价不允许伪造零金额', () => {
  const parsed = ExecutionValuationObservationSchema.parse(valued);
  expect(parsed.usageRevision).toBe(1); expect(parsed.valuationRevision).toBe(2);
  expect(ExecutionValuationObservationSchema.safeParse({ ...valued, currency: 'USD' }).success).toBe(false);
  for (const availability of ['unpriced', 'pending', 'not-authorized']) {
    expect(ExecutionValuationObservationSchema.safeParse({ ...valued, availability, priceVersionRef: null, amountDecimal: null }).success).toBe(true);
    expect(ExecutionValuationObservationSchema.safeParse({ ...valued, availability, amountDecimal: '0' }).success).toBe(false);
  }
  expect(ExecutionValuationObservationSchema.safeParse({ ...valued, amountDecimal: '0' }).success).toBe(true);
});

test('快照续页固定身份，增量与快照游标不混用', () => {
  expect(ExecutionObservationQuerySchema.parse({})).toEqual({ limit: 200 });
  for (const input of [{ snapshot: 'true' }, { snapshot: 'true', snapshotId: 'snap', cursor: '20' }, { after: '10', limit: '500' }]) expect(ExecutionObservationQuerySchema.safeParse(input).success).toBe(true);
  for (const input of [{ snapshot: 'true', cursor: '20' }, { snapshot: 'true', snapshotId: 'snap' }, { snapshot: 'true', after: '10' }, { limit: 501 }]) expect(ExecutionObservationQuerySchema.safeParse(input).success).toBe(false);
  expect(ExecutionObservationPageSchema.safeParse({ ...page, mode: 'snapshot', snapshotId: 'snap', snapshotThrough: '3', expiresAt: time }).success).toBe(true);
  expect(ExecutionObservationPageSchema.safeParse({ ...page, mode: 'snapshot' }).success).toBe(false);
});

test('空页仍携带可见性修订，隐藏金额不会保留旧的可用费用', () => {
  expect(ExecutionObservationPageSchema.safeParse(page).success).toBe(true);
  expect(ExecutionObservationPageSchema.safeParse({ ...page, costVisibility: 'hidden' }).success).toBe(false);
  expect(ExecutionObservationPageSchema.safeParse({ ...page, costVisibility: 'hidden', visibilityRevision: 3, items: [] }).success).toBe(true);
  expect(ExecutionObservationPageSchema.safeParse({ ...page, items: [{ ...usage, identity: { ...identity, projectId: '01a0bf5d-8f4b-7000-9e4b-b54e91ee9d11' } }] }).success).toBe(false);
});


test('父汇总与后代明细携带完整祖先路径和原生轮次，不能靠接收时间猜覆盖', () => {
  const projection = { ...usage.projection, coveredThrough: { input: 0, output: null, cacheRead: 0, cacheWrite: null } };
  const parent = { ...usage, projection, inclusion: 'includes-descendants', scope: { root: 'root', session: 'root', parentSession: null,
    ancestors: [], turn: 'session-total', turnIndex: 0, level: 'tree-total' }, coveredThroughTurn: 0 };
  const child = { ...usage, projection, recordId: 'child-meter', reporting: 'delta', scope: { root: 'root', session: 'grandchild', parentSession: 'child',
    ancestors: ['root', 'child'], turn: 'new-turn', turnIndex: 1, level: 'request' }, coveredThroughTurn: null };
  expect(ExecutionUsageObservationSchema.parse(parent).coveredThroughTurn).toBe(0);
  expect(ExecutionUsageObservationSchema.parse(child).scope?.turnIndex).toBe(1);
  for (const patch of [{ scope: null }, { coveredThroughTurn: null }, { coveredThroughTurn: -1 }, { scope: { ...parent.scope, ancestors: ['root'] } }])
    expect(ExecutionUsageObservationSchema.safeParse({ ...parent, ...patch }).success).toBe(false);
  expect(ExecutionUsageObservationSchema.safeParse({ ...child, scope: { ...child.scope, ancestors: ['root'] } }).success).toBe(false);
});


test('冻结快照携带归一后的逐桶贡献和水位，不依赖客户端仍保留历史修订', () => {
  const snapshot = { ...usage, revision: 2, usage: { input: null, output: '5', cacheRead: '0', cacheWrite: '0' },
    scope: { root: 'root', session: 'root', parentSession: null, ancestors: [], turn: 'session-total', turnIndex: 0, level: 'tree-total' },
    inclusion: 'includes-descendants', coveredThroughTurn: 1,
    projection: { projectionRevision: 1, observedRevision: 2, contribution: { input: '100', output: '5', cacheRead: '0', cacheWrite: '0' },
      coveredThrough: { input: 0, output: 1, cacheRead: 1, cacheWrite: 1 }, complete: false, issues: [] } };
  const parsed = ExecutionUsageObservationSchema.parse(snapshot);
  expect(parsed.usage.input).toBeNull();
  expect(parsed.projection.contribution.input).toBe('100');
  expect(parsed.projection.coveredThrough).toEqual({ input: 0, output: 1, cacheRead: 1, cacheWrite: 1 });
  expect(ExecutionUsageObservationSchema.safeParse({ ...snapshot, projection: { ...snapshot.projection, coveredThrough: null } }).success).toBe(false);
  expect(ExecutionUsageObservationSchema.safeParse({ ...snapshot, projection: { ...snapshot.projection, observedRevision: 1 } }).success).toBe(false);
  expect(ExecutionUsageObservationSchema.safeParse({ ...snapshot, projection: { ...snapshot.projection, contribution: { ...snapshot.projection.contribution, input: null } } }).success).toBe(false);
});


test('迟到的较早测量也能产生更高投影修订，不复用最高原生修订作替换版本', () => {
  const crashed = ExecutionUsageObservationSchema.parse({ ...usage, revision: 2, validity: 'invalid-final',
    projection: { ...usage.projection, projectionRevision: 1, observedRevision: 2, contribution: { input: null, cacheRead: null, cacheWrite: null, output: null }, issues: ['invalid-final'] } });
  const recovered = ExecutionUsageObservationSchema.parse({ ...usage, revision: 1,
    projection: { ...usage.projection, projectionRevision: 2, observedRevision: 2, issues: ['invalid-final'] } });
  expect(crashed.projection.observedRevision).toBe(recovered.projection.observedRevision);
  expect(recovered.projection.projectionRevision).toBeGreaterThan(crashed.projection.projectionRevision);
  expect(recovered.projection.contribution.input).toBe('100');
});


test('模型证据修订可晚于已接受数字，但不能来自尚未观察或未知模型', () => {
  const input = { ...usage, revision: 1, modelRef: 'actual', projection: { ...usage.projection, observedRevision: 2, modelRevision: 2 } };
  expect(ExecutionUsageObservationSchema.safeParse(input).success).toBe(true);
  expect(ExecutionUsageObservationSchema.safeParse({ ...input, modelRef: null }).success).toBe(false);
  expect(ExecutionUsageObservationSchema.safeParse({ ...input, projection: { ...input.projection, modelRevision: 3 } }).success).toBe(false);
  expect(ExecutionUsageObservationSchema.safeParse({ ...input, projection: { ...input.projection, modelRevision: 0 } }).success).toBe(false);
});
