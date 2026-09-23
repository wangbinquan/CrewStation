import { describe, expect, test } from 'bun:test';
import { ResourceRecordSchema, isLiveResourcePhase, occupiesQuotaPhase, resourceCondition } from './resourceRecord';
import { ResourceProjectParamsSchema, ResourceStreamCursorSchema, ResourceStreamEventSchema, ResourceViewQuerySchema, resourceCount } from './resourceView';

const at = '2026-09-23T12:00:00.000Z';
const record = {
  id: '01a0bf5d-8f4b-7c01-8e19-e226732a75a4', kind: 'agent-execution', projectId: '01a0bf5d-8f4b-7c02-8e19-e226732a75a4', owner: { module: 'task-runtime', ref: 'env' },
  parentId: '01a0bf5d-8f4b-7c03-8e19-e226732a75a4', purpose: 'development-cli', phase: 'stopping', phaseSince: at,
  conditions: [{ type: 'RunnerConnected', status: 'false', since: at }], children: [{ kind: 'Pod', namespace: 'cs-demo', name: 'cli-1', phase: 'Running', ready: true, observedAt: at }],
  generation: 2, observedGeneration: 1, actions: [{ id: 'release', enabled: false, disabledReason: '正在结束' }], version: 7, createdAt: at, updatedAt: at,
};

describe('RFC-025 标准记录', () => {
  test('合法记录通过；多余字段与非 UUIDv7 的 ID 被拒', () => {
    expect(ResourceRecordSchema.safeParse(record).success).toBe(true);
    expect(ResourceRecordSchema.safeParse({ ...record, spec: {} }).success).toBe(false);
    expect(ResourceRecordSchema.safeParse({ ...record, id: 'tsk_legacy' }).success).toBe(false);
    expect(ResourceRecordSchema.safeParse({ ...record, phase: 'running' }).success).toBe(false);
  });

  test('在运行与占额度：结束中不算在运行但仍占额度，终态都不占', () => {
    expect(['pending', 'provisioning', 'starting', 'ready', 'degraded'].every((phase) => isLiveResourcePhase(phase as never))).toBe(true);
    expect(isLiveResourcePhase('stopping')).toBe(false);
    expect(occupiesQuotaPhase('stopping')).toBe(true);
    expect(occupiesQuotaPhase('stopped')).toBe(false);
    expect(occupiesQuotaPhase('failed')).toBe(false);
  });

  test('条件按类型取，没有就是 undefined；计数缺格即 0', () => {
    expect(resourceCondition(ResourceRecordSchema.parse(record), 'RunnerConnected')?.status).toBe('false');
    expect(resourceCondition(ResourceRecordSchema.parse(record), 'Paused')).toBeUndefined();
    expect(resourceCount({ 'agent-execution': { ready: 2, starting: 1 } }, 'agent-execution', ['ready', 'starting', 'pending'])).toBe(3);
    expect(resourceCount({}, 'dev-workspace', ['ready'])).toBe(0);
  });

  test('推送事件按 type 区分；视图查询缺省不带已结束的记录', () => {
    expect(ResourceStreamEventSchema.parse({ type: 'upsert', record, counts: {}, cursor: 9 }).type).toBe('upsert');
    expect(ResourceStreamEventSchema.safeParse({ type: 'upsert', counts: {}, cursor: 9 }).success).toBe(false);
    expect(ResourceStreamEventSchema.parse({ type: 'heartbeat', at }).type).toBe('heartbeat');
    expect(ResourceViewQuerySchema.parse({})).toEqual({ includeStopped: 'false' });
  });

  test('路径里的项目 ID 必须是 UUIDv7；续传游标是非负整数（Last-Event-ID 是字符串）', () => {
    expect(ResourceProjectParamsSchema.safeParse({ projectId: record.projectId }).success).toBe(true);
    expect(ResourceProjectParamsSchema.safeParse({ projectId: 'demo' }).success).toBe(false);
    expect(ResourceStreamCursorSchema.parse('42')).toBe(42);
    expect(ResourceStreamCursorSchema.safeParse('-1').success).toBe(false);
    expect(ResourceStreamCursorSchema.safeParse('1.5').success).toBe(false);
  });
});
