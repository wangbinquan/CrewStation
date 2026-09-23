import { describe, expect, test } from 'bun:test';
import type { ResourceChild, ResourceCondition } from '@crewstation/contracts';
import { actionsFor } from './actions';
import { countByKindPhase, mergeConditions } from './conditions';
import { computePhase, settlePhase } from './phase';
import type { LedgerRecord } from './record';
import { childKey, expectedChildren, mergeChildren } from './record';

const t0 = new Date('2026-09-23T12:00:00.000Z');
const pod = (phase: string, ready = false, extra: Partial<ResourceChild> = {}): ResourceChild => ({ kind: 'Pod', namespace: 'cs-demo', name: 'task-1', phase, ready, ...extra });
const cond = (type: string, status: ResourceCondition['status'], extra: Partial<ResourceCondition> = {}): ResourceCondition => ({ type, status, since: t0.toISOString(), ...extra });
const record = (patch: Partial<LedgerRecord> = {}): LedgerRecord => ({
  id: '01a0bf5d-8f4b-7c01-8e19-e226732a75a4', kind: 'dev-workspace', owner: { module: 'task-runtime', ref: 'x' }, desired: 'present',
  spec: { children: [{ kind: 'Pod', namespace: 'cs-demo', name: 'task-1' }] }, generation: 1, observedGeneration: 0, conditions: [], children: [], display: {},
  phase: 'provisioning', phaseSince: t0, aliases: [], version: 1, createdAt: t0, updatedAt: t0, ...patch,
});

describe('阶段规则（RFC-025 设计 §2.3）', () => {
  test('不要了：还有子对象是结束中，都回收了是已结束；受理释放的那一刻就是结束中', () => {
    expect(computePhase(record({ desired: 'absent', children: [pod('Running', true)] })).phase).toBe('stopping');
    expect(computePhase(record({ desired: 'absent', children: [pod('absent')] })).phase).toBe('stopped');
    expect(computePhase(record({ desired: 'absent', releaseReason: { code: 'user', message: '用户释放' }, children: [] }))).toEqual({ phase: 'stopped', reason: { code: 'user', message: '用户释放' } });
  });

  test('还没有 Pod：未准备好是排队中，否则分配中；Pod 在建或未就绪是启动中，原因带上等待说明', () => {
    expect(computePhase(record({ kind: 'agent-execution', conditions: [cond('Prepared', 'false')] })).phase).toBe('pending');
    expect(computePhase(record()).phase).toBe('provisioning');
    expect(computePhase(record({ children: [pod('Pending', false, { reason: '0/1 nodes are available' })] }))).toEqual({ phase: 'starting', reason: { code: 'waiting-container', message: '0/1 nodes are available' } });
    expect(computePhase(record({ children: [pod('Running', false)] })).phase).toBe('starting');
  });

  test('Pod 就绪还要 Runner 连上才是运行中；从没连上是启动中，连上后又断开是降级，重建中按重新启动算', () => {
    expect(computePhase(record({ children: [pod('Running', true)] })).phase).toBe('starting');
    expect(computePhase(record({ children: [pod('Running', true)], conditions: [cond('RunnerConnected', 'true')] })).phase).toBe('ready');
    expect(computePhase(record({ children: [pod('Running', true)], conditions: [cond('RunnerConnected', 'false', { message: 'Runner 断开' })] }))).toEqual({ phase: 'degraded', reason: { code: 'RunnerConnected-false', message: 'Runner 断开' } });
    expect(computePhase(record({ children: [pod('Running', true)], conditions: [cond('RunnerConnected', 'false'), cond('Rebuilding', 'true')] })).phase).toBe('starting');
  });

  test('失败条件优先于观测；暂停是结束中或已结束；Pod 已退出是降级（判失败归所属模块）', () => {
    expect(computePhase(record({ children: [pod('Running', true)], conditions: [cond('Failed', 'true', { reason: 'connect-timeout', message: '超过 5 分钟未连接' })] }))).toEqual({ phase: 'failed', reason: { code: 'connect-timeout', message: '超过 5 分钟未连接' } });
    expect(computePhase(record({ kind: 'business-workspace', conditions: [cond('Paused', 'true')], children: [pod('Running', true)] })).phase).toBe('stopping');
    expect(computePhase(record({ kind: 'business-workspace', conditions: [cond('Paused', 'true')] })).phase).toBe('stopped');
    expect(computePhase(record({ children: [pod('Failed', false, { reason: 'OOMKilled' })] }))).toEqual({ phase: 'degraded', reason: { code: 'pod-failed', message: '容器运行失败：OOMKilled' } });
  });

  test('工作卷：Bound 是运行中，Pending 是分配中，Lost 是降级；不要了且 PVC 还在是结束中', () => {
    const volume = (phase: string, desired: 'present' | 'absent' = 'present') => record({ kind: 'volume', desired, spec: { children: [{ kind: 'PersistentVolumeClaim', namespace: 'cs-demo', name: 'task-1-work' }] }, children: [{ kind: 'PersistentVolumeClaim', namespace: 'cs-demo', name: 'task-1-work', phase, ready: phase === 'Bound' }] });
    expect(computePhase(volume('Bound')).phase).toBe('ready');
    expect(computePhase(volume('Pending')).phase).toBe('provisioning');
    expect(computePhase(volume('Lost')).phase).toBe('degraded');
    expect(computePhase(volume('Bound', 'absent')).phase).toBe('stopping');
  });

  test('收束：阶段变了才换起始时间；开发会话进入失败写 72 小时保留，离开失败清掉；没有变化返回同一对象', () => {
    const t1 = new Date(t0.getTime() + 60_000);
    const failed = settlePhase(record({ conditions: [cond('Failed', 'true')] }), t1);
    expect(failed.phase).toBe('failed'); expect(failed.phaseSince).toEqual(t1);
    expect(failed.retainUntil?.toISOString()).toBe(new Date(t1.getTime() + 72 * 3_600_000).toISOString());
    expect(settlePhase(failed, new Date(t1.getTime() + 5_000))).toBe(failed);
    const cli = settlePhase(record({ kind: 'agent-execution', conditions: [cond('Failed', 'true')] }), t1);
    expect(cli.retainUntil).toBeUndefined();
    const retried = settlePhase({ ...failed, conditions: [cond('Failed', 'false')] }, t1);
    expect(retried.phase).toBe('provisioning'); expect(retried.retainUntil).toBeUndefined(); expect(retried.reason).toBeUndefined();
  });
});

describe('条件、子对象、计数与可做操作', () => {
  test('条件状态变了才换起始时间，只改说明不换；重复上报返回原数组', () => {
    const t1 = new Date(t0.getTime() + 1000);
    const first = mergeConditions([], [{ type: 'RunnerConnected', status: 'true' }], t0);
    expect(mergeConditions(first, [{ type: 'RunnerConnected', status: 'true' }], t1)).toBe(first);
    const reworded = mergeConditions(first, [{ type: 'RunnerConnected', status: 'true', message: '已连接' }], t1);
    expect(reworded[0]).toEqual({ type: 'RunnerConnected', status: 'true', message: '已连接', since: t0.toISOString() });
    expect(mergeConditions(reworded, [{ type: 'RunnerConnected', status: 'false' }], t1)[0]?.since).toBe(t1.toISOString());
  });

  test('子对象合并：期望的都在（没观测到记 absent），期望里没了但还在的旧对象留到它消失', () => {
    const merged = mergeChildren([{ kind: 'Pod', namespace: 'cs-demo', name: 'task-r-2' }], [pod('Running', true), { ...pod('absent'), name: 'gone' }]);
    expect(merged.map(childKey)).toEqual(['Pod/cs-demo/task-r-2', 'Pod/cs-demo/task-1']);
    expect(merged[0]?.phase).toBe('absent');
    expect(expectedChildren({ spec: { children: [{ kind: 'Pod', namespace: 'cs-demo', name: 'task-r-2' }] }, children: merged }).map((c) => c.name)).toEqual(['task-r-2']);
  });

  test('计数按种类 × 阶段；可做操作按阶段给出能不能做与原因', () => {
    expect(countByKindPhase([{ kind: 'agent-execution', phase: 'ready' }, { kind: 'agent-execution', phase: 'ready' }, { kind: 'dev-workspace', phase: 'failed' }])).toEqual({ 'agent-execution': { ready: 2 }, 'dev-workspace': { failed: 1 } });
    expect(actionsFor(record({ phase: 'ready' }))).toEqual([{ id: 'release', enabled: true }, { id: 'retry', enabled: false, disabledReason: '只有失败的才可以重试' }]);
    expect(actionsFor(record({ kind: 'agent-execution', desired: 'absent', phase: 'stopping' }))[0]).toEqual({ id: 'release', enabled: false, disabledReason: '已受理释放，正在回收' });
    expect(actionsFor(record({ phase: 'failed' }))[1]).toEqual({ id: 'retry', enabled: true });
    expect(actionsFor(record({ kind: 'volume', conditions: [cond('PendingReclaim', 'true')] }))).toEqual([{ id: 'delete-volume', enabled: true }]);
    expect(actionsFor(record({ kind: 'business-workspace' }))).toEqual([]);
  });
});
