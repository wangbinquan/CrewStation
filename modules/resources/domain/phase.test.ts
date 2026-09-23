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

  test('收束：阶段变了才换起始时间；开发会话失败保留 72 小时、从失败的时刻起算，离开失败清掉；没有变化返回同一对象', () => {
    const t1 = new Date(t0.getTime() + 60_000);
    // 「失败」条件自 t0 起成立（所属模块报来的发生时刻）：保留到 t0＋72 小时，不是记录进入失败的 t1。
    const failed = settlePhase(record({ conditions: [cond('Failed', 'true')] }), t1);
    expect(failed.phase).toBe('failed'); expect(failed.phaseSince).toEqual(t1);
    expect(failed.retainUntil?.toISOString()).toBe(new Date(t0.getTime() + 72 * 3_600_000).toISOString());
    expect(settlePhase(failed, new Date(t1.getTime() + 5_000))).toBe(failed);
    // 台账接上之前两天就失败的会话（补投影）：只剩一天。
    const legacy = settlePhase(record({ conditions: [cond('Failed', 'true', { since: new Date(t0.getTime() - 48 * 3_600_000).toISOString() })] }), t1);
    expect(legacy.retainUntil?.toISOString()).toBe(new Date(t0.getTime() + 24 * 3_600_000).toISOString());
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

  test('报告方给了发生时刻：状态变化时用它；同一状态只往早改；晚于现在的不认', () => {
    const t1 = new Date(t0.getTime() + 60_000), earlier = new Date(t0.getTime() - 3_600_000), future = new Date(t1.getTime() + 60_000);
    const first = mergeConditions([], [{ type: 'Failed', status: 'true', since: t0 }], t1);
    expect(first[0]?.since).toBe(t0.toISOString());
    expect(mergeConditions(first, [{ type: 'Failed', status: 'true', since: earlier }], t1)[0]?.since).toBe(earlier.toISOString());
    expect(mergeConditions(first, [{ type: 'Failed', status: 'true', since: t1 }], t1)).toBe(first);
    expect(mergeConditions([], [{ type: 'Failed', status: 'true', since: future }], t1)[0]?.since).toBe(t1.toISOString());
  });

  test('服务槽：Deployment 就绪是运行中、推进中是启动中、推进超时与副本为 0 是降级；Serving 为假（已下线、尚未部署）是已结束，工作负载还在时是结束中', () => {
    const slot = (child?: Partial<ResourceChild>, conditions: ResourceCondition[] = []) => record({ kind: 'service-slot', spec: { children: [{ kind: 'Deployment', namespace: 'cs-demo', name: 'demo-green' }] }, conditions,
      children: child ? [{ kind: 'Deployment', namespace: 'cs-demo', name: 'demo-green', phase: 'Available', ready: true, ...child }] : [] });
    expect(computePhase(slot({})).phase).toBe('ready');
    expect(computePhase(slot({ phase: 'Progressing', ready: false, reason: '副本 0／1 就绪' }))).toEqual({ phase: 'starting', reason: { code: 'rolling-out', message: '副本 0／1 就绪' } });
    expect(computePhase(slot({ phase: 'Stalled', ready: false, reason: 'ProgressDeadlineExceeded' })).reason?.code).toBe('rollout-stalled');
    expect(computePhase(slot({ phase: 'ScaledDown', ready: false })).reason?.code).toBe('scaled-down');
    expect(computePhase(slot({ phase: 'Unready', ready: false, reason: '副本 0／1 就绪' }))).toEqual({ phase: 'degraded', reason: { code: 'pods-unready', message: '副本 0／1 就绪' } });
    expect(computePhase(slot()).phase).toBe('provisioning');
    const offline = cond('Serving', 'false', { reason: 'offline-idle', message: '待验证版本无人访问，已自动下线' });
    expect(computePhase(slot(undefined, [offline]))).toEqual({ phase: 'stopped', reason: { code: 'offline-idle', message: '待验证版本无人访问，已自动下线' } });
    expect(computePhase(slot({}, [offline])).phase).toBe('stopping');
  });

  test('待回收的工作卷：上级已结束、卷还在，按已结束算，原因写明；受理删除后照常是结束中', () => {
    const volume = (extra: Partial<LedgerRecord> = {}) => record({ kind: 'volume', spec: { children: [{ kind: 'PersistentVolumeClaim', namespace: 'cs-demo', name: 'task-1-work' }] }, children: [{ kind: 'PersistentVolumeClaim', namespace: 'cs-demo', name: 'task-1-work', phase: 'Bound', ready: true }], ...extra });
    expect(computePhase(volume({ conditions: [cond('PendingReclaim', 'true', { reason: 'retention-expired', message: '失败保留期已满' })] }))).toEqual({ phase: 'stopped', reason: { code: 'retention-expired', message: '失败保留期已满' } });
    expect(computePhase(volume({ conditions: [cond('PendingReclaim', 'true')] })).reason?.code).toBe('pending-reclaim');
    expect(computePhase(volume({ desired: 'absent', conditions: [cond('PendingReclaim', 'true')] })).phase).toBe('stopping');
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
