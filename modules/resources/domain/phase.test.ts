import { describe, expect, test } from 'bun:test';
import type { ResourceChild, ResourceCondition } from '@crewstation/contracts';
import { actionsFor } from './actions';
import { countByKindPhase, mergeConditions } from './conditions';
import { STABLE_KINDS } from './kinds';
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
    // RFC-025 I25：资源中心建过却没建成（例如被额度拒绝）照原因写；没有说明的不编原因。
    expect(computePhase(record({ conditions: [cond('Created', 'false', { reason: 'create-failed', message: '容器没有建成：exceeded quota' })] }))).toEqual({ phase: 'provisioning', reason: { code: 'create-failed', message: '容器没有建成：exceeded quota' } });
    expect(computePhase(record({ conditions: [cond('Created', 'false', { message: '没建成' })] })).reason?.code).toBe('create-failed');
    expect(computePhase(record({ conditions: [cond('Created', 'false')] }))).toEqual({ phase: 'provisioning' });
    // 执行环境（I25 第二步）排队时 Prepared 为假：建不成的原因比「排队」有用；没有说明的照旧是排队。
    expect(computePhase(record({ kind: 'agent-execution', conditions: [cond('Prepared', 'false'), cond('Created', 'false', { reason: 'create-failed', message: '容器没有建成：forbidden' })] }))).toEqual({ phase: 'provisioning', reason: { code: 'create-failed', message: '容器没有建成：forbidden' } });
    expect(computePhase(record({ kind: 'agent-execution', conditions: [cond('Prepared', 'false'), cond('Created', 'false')] })).phase).toBe('pending');
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

  test('终态条件：Job 的结果（Finished）一旦为真，读到的旧版本（还在跑）不能把它改回假，说明也不再改；为假时照常更新', () => {
    const t1 = new Date(t0.getTime() + 1000);
    const running = mergeConditions([], [{ type: 'Finished', status: 'false' }], t0);
    const done = mergeConditions(running, [{ type: 'Finished', status: 'true', reason: 'succeeded', message: '已完成' }], t1);
    expect(done[0]).toMatchObject({ status: 'true', reason: 'succeeded', since: t1.toISOString() });
    expect(mergeConditions(done, [{ type: 'Finished', status: 'false' }], t1)).toBe(done);
    expect(mergeConditions(done, [{ type: 'Finished', status: 'true', reason: 'failed', message: '另一个说法' }], t1)).toBe(done);
    // 别的条件不受影响：连上之后可以断开。
    const connected = mergeConditions([], [{ type: 'RunnerConnected', status: 'true' }], t0);
    expect(mergeConditions(connected, [{ type: 'RunnerConnected', status: 'false' }], t1)[0]?.status).toBe('false');
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
    // 资源中心判定槽的 Pod 在崩溃重启：副本眼下都就绪也是降级，原因照条件写；条件撤掉就回到运行中。
    // 槽的 Service 下线也保留（RFC-021）：工作负载没了就是已结束，不因 Service 还在停在结束中。
    const idle = record({ kind: 'service-slot', spec: { children: [{ kind: 'Deployment', namespace: 'cs-demo', name: 'demo-green' }, { kind: 'Service', namespace: 'cs-demo', name: 'demo-green' }] },
      children: [{ kind: 'Deployment', namespace: 'cs-demo', name: 'demo-green', phase: 'absent', ready: false }, { kind: 'Service', namespace: 'cs-demo', name: 'demo-green', phase: 'Present', ready: true }], conditions: [offline] });
    expect(computePhase(idle)).toEqual({ phase: 'stopped', reason: { code: 'offline-idle', message: '待验证版本无人访问，已自动下线' } });
    const looping = cond('CrashLooping', 'true', { reason: 'restarting', message: '容器反复重启：累计重启 4 次，10 分钟内仍有重启' });
    expect(computePhase(slot({}, [looping]))).toEqual({ phase: 'degraded', reason: { code: 'crash-looping', message: '容器反复重启：累计重启 4 次，10 分钟内仍有重启' } });
    expect(computePhase(slot({}, [{ ...looping, status: 'false' }])).phase).toBe('ready');
    expect(computePhase(slot({}, [cond('CrashLooping', 'true')])).reason?.message).toBe('容器反复重启');
  });

  test('限流策略：期望里的中间件都在即运行中，缺一个就还在分配中；稳定记录', () => {
    const children = ['rate-limit-user', 'rate-limit-host'].map((name) => ({ kind: 'Middleware', namespace: 'cs-demo', name }));
    const policy = (present: readonly string[]) => record({ kind: 'rate-limit-policy', spec: { children },
      children: children.map((child) => ({ ...child, phase: present.includes(child.name) ? 'Present' : 'absent', ready: present.includes(child.name) })) });
    expect(computePhase(policy(['rate-limit-user', 'rate-limit-host']))).toEqual({ phase: 'ready' });
    expect(computePhase(policy(['rate-limit-user'])).phase).toBe('provisioning');
    expect(STABLE_KINDS).toContain('rate-limit-policy');
  });

  test('命名空间与网络策略（第四期）：Namespace 与额度都在、每条网络策略都在才运行中；稳定记录', () => {
    const children = [{ kind: 'Namespace', name: 'cs-demo' }, { kind: 'ResourceQuota', namespace: 'cs-demo', name: 'crewstation-project' }];
    const ns = (present: readonly string[]) => record({ kind: 'namespace', spec: { children },
      children: children.map((child) => ({ ...child, phase: present.includes(child.kind) ? 'Present' : 'absent', ready: present.includes(child.kind) })) });
    expect(computePhase(ns(['Namespace', 'ResourceQuota']))).toEqual({ phase: 'ready' });
    expect(computePhase(ns(['Namespace'])).phase).toBe('provisioning');
    expect(computePhase(record({ kind: 'network-policy-set', spec: { children: [{ kind: 'NetworkPolicy', namespace: 'cs-demo', name: 'crewstation-default' }] }, children: [] })).phase).toBe('provisioning');
    expect(STABLE_KINDS).toEqual(expect.arrayContaining(['namespace', 'network-policy-set']));
    // 有人删了命名空间：它还在（删除中）、却要没了——降级并写明，删完后调和器补回。
    const deleting = record({ kind: 'namespace', spec: { children }, children: [{ ...children[0]!, phase: 'Terminating', ready: false }, { ...children[1]!, phase: 'Present', ready: true }] });
    expect(computePhase(deleting)).toEqual({ phase: 'degraded', reason: { code: 'child-terminating', message: 'Namespace cs-demo 正在删除，删完后按期望补回' } });
  });

  test('数据库与数据访问绑定（第四期，T12）：库与角色都观测到了才运行中；绑定等批准时排队，生效且角色在才运行中', () => {
    const children = [{ kind: 'PostgresDatabase', name: 'cs_demo' }, { kind: 'PostgresRole', name: 'cs_demo' }];
    const seen = (names: readonly string[]) => children.map((child) => ({ ...child, phase: names.includes(child.kind) ? 'Present' : 'absent', ready: names.includes(child.kind) }));
    expect(computePhase(record({ kind: 'database', spec: { children }, children: seen(['PostgresDatabase', 'PostgresRole']) }))).toEqual({ phase: 'ready' });
    expect(computePhase(record({ kind: 'database', spec: { children }, children: seen(['PostgresDatabase']) })).phase).toBe('provisioning');
    expect(computePhase(record({ kind: 'database', spec: { children }, children: seen([]), conditions: [cond('Failed', 'true', { message: '建库失败' })] }))).toEqual({ phase: 'failed', reason: { code: 'failed', message: '建库失败' } });
    expect(STABLE_KINDS).toContain('database');
    expect(STABLE_KINDS).not.toContain('data-binding');
    const role = [{ kind: 'PostgresRole', name: 'cs_t_1' }];
    const binding = (over: Partial<Parameters<typeof record>[0]>) => record({ kind: 'data-binding', spec: { children: role }, children: [], ...over });
    // 等负责人批准：排队，原因照所属模块的说法；没给说法时是缺省的排队说明。
    expect(computePhase(binding({ conditions: [cond('Prepared', 'false', { reason: 'awaiting-approval', message: '等负责人批准' })] }))).toEqual({ phase: 'pending', reason: { code: 'awaiting-approval', message: '等负责人批准' } });
    expect(computePhase(binding({ conditions: [cond('Prepared', 'false')] })).reason?.code).toBe('queued');
    // 批准了、角色还没观测到：分配中；角色在但还没报生效：分配中；都齐：运行中。
    expect(computePhase(binding({ conditions: [cond('Granted', 'true')] })).phase).toBe('provisioning');
    const present = [{ ...role[0]!, phase: 'Present', ready: true }];
    expect(computePhase(binding({ children: present })).phase).toBe('provisioning');
    expect(computePhase(binding({ children: present, conditions: [cond('Granted', 'true')] }))).toEqual({ phase: 'ready' });
    // 开发模式的绑定没有数据面对象：报了生效即运行中。
    expect(computePhase(record({ kind: 'data-binding', spec: { children: [] }, children: [], conditions: [cond('Granted', 'true')] }))).toEqual({ phase: 'ready' });
  });

  test('路由：IngressRoute 还没观测到是分配中，在即运行中，删除中按启动中算；稳定记录', () => {
    const route = (child?: Partial<ResourceChild>) => record({ kind: 'route', spec: { children: [{ kind: 'IngressRoute', namespace: 'cs-demo', name: 'demo-prod' }] },
      children: child ? [{ kind: 'IngressRoute', namespace: 'cs-demo', name: 'demo-prod', phase: 'Present', ready: true, ...child }] : [] });
    expect(computePhase(route()).phase).toBe('provisioning');
    expect(computePhase(route({}))).toEqual({ phase: 'ready' });
    expect(computePhase(route({ phase: 'Terminating', ready: false }))).toEqual({ phase: 'starting', reason: { code: 'route-replacing', message: '路由正在替换' } });
    expect(STABLE_KINDS).toContain('route');
  });

  test('构建、迁移 Job：还没建是分配中，建了没跑起来是启动中（原因照 Pod），在跑是运行中；资源中心记下结束后照它——Job 被 TTL 删掉结果也在', () => {
    const job = (child?: Partial<ResourceChild>, conditions: ResourceCondition[] = [], pods: ResourceChild[] = []) => record({ kind: 'build-job', spec: { children: [{ kind: 'Job', namespace: 'cs-demo', name: 'build-1' }] }, conditions,
      children: [...(child ? [{ kind: 'Job', namespace: 'cs-demo', name: 'build-1', phase: 'Active', ready: false, ...child }] : []), ...pods] });
    expect(computePhase(job()).phase).toBe('provisioning');
    expect(computePhase(job({ phase: 'Pending' }, [], [{ kind: 'Pod', namespace: 'cs-demo', name: 'build-1-x', phase: 'Pending', ready: false, reason: '0/1 nodes are available: Insufficient cpu' }])))
      .toEqual({ phase: 'starting', reason: { code: 'waiting-container', message: '0/1 nodes are available: Insufficient cpu' } });
    expect(computePhase(job({ phase: 'Pending' }))).toEqual({ phase: 'starting' });
    expect(computePhase(job({}))).toEqual({ phase: 'ready' });
    const done = cond('Finished', 'true', { reason: 'succeeded', message: '已完成' });
    expect(computePhase(job({ phase: 'Complete', ready: true }, [done]))).toEqual({ phase: 'stopped', reason: { code: 'completed', message: '已完成' } });
    expect(computePhase(job(undefined, [done])).phase).toBe('stopped');
    expect(computePhase(job(undefined, [cond('Finished', 'true', { reason: 'failed', message: 'BackoffLimitExceeded' })]))).toEqual({ phase: 'failed', reason: { code: 'job-failed', message: 'BackoffLimitExceeded' } });
    expect(computePhase(job(undefined, [cond('Finished', 'true', { reason: 'failed' })])).reason?.message).toBe('任务失败');
    expect(computePhase(job(undefined, [cond('Finished', 'true')])).reason?.message).toBe('已完成');
    expect(computePhase(job({}, [cond('Finished', 'false')])).phase).toBe('ready');
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
