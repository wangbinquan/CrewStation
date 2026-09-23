import { expect, test } from 'bun:test';
import type { StartupRecord } from '@crewstation/contracts';
import type { StartupObservation } from './podStartup';
import { advanceStartup, cancelStartup, completeStage, completeThrough, defaultFailureCode, failAtStage, failStartup, failureCode, initialStartup, runningStage } from './podStartup';
import type { TaskEnvironment } from './taskEnvironment';
import { transition } from './taskEnvironment';

const t0 = new Date('2026-09-23T03:00:00.000Z');
const at = (second: number) => new Date(t0.getTime() + second * 1000).toISOString();
const kinds = (record: StartupRecord) => record.stages.map((stage) => `${stage.kind}:${stage.state}`);
const IMAGE = 'registry.local/crewstation/task@sha256:0123456789abcdef0123456789abcdef';
const observed = (patch: Partial<StartupObservation> = {}): StartupObservation => ({ containers: [{ name: 'checkout', init: true, image: IMAGE }, { name: 'task-1', init: false, image: IMAGE }], pulls: [], ...patch });

test('三种形状：首次创建的开发会话带检出与分支、重建带替换旧容器、其余四段；只有第一段在进行', () => {
  expect(kinds(initialStartup(t0, { checkout: 'main' }))).toEqual(['queue:running', 'container:pending', 'checkout:pending', 'connect:pending', 'ready:pending']);
  expect(initialStartup(t0, { checkout: 'main' }).stages[2]!.subject).toBe('main');
  expect(kinds(initialStartup(t0, { rebuild: true }))).toEqual(['queue:running', 'replace:pending', 'container:pending', 'connect:pending', 'ready:pending']);
  expect(initialStartup(t0)).toEqual({ state: 'running', startedAt: at(0), stages: [{ kind: 'queue', state: 'running', startedAt: at(0) }, { kind: 'container', state: 'pending' }, { kind: 'connect', state: 'pending' }, { kind: 'ready', state: 'pending' }] });
});

test('一段成功：下一段从同一刻开始；下一段是已就绪时一并成功；只进不退；结束早于开始时取开始时间', () => {
  const queued = completeStage(initialStartup(t0), 'queue', at(1));
  expect(queued.stages.slice(0, 2)).toEqual([{ kind: 'queue', state: 'succeeded', startedAt: at(0), endedAt: at(1), durationMs: 1000 }, { kind: 'container', state: 'running', startedAt: at(1) }]);
  expect(completeStage(queued, 'queue', at(9))).toBe(queued);
  expect(completeStage(queued, 'connect', at(9))).toBe(queued);
  const early = completeStage(queued, 'container', at(0.5));
  expect(early.stages[1]).toMatchObject({ state: 'succeeded', endedAt: at(1), durationMs: 0 });
  const ready = completeStage(early, 'connect', at(3));
  expect(ready.state).toBe('ready'); expect(ready.endedAt).toBe(at(3));
  expect(ready.stages.at(-1)).toEqual({ kind: 'ready', state: 'succeeded', startedAt: at(3), endedAt: at(3), durationMs: 0 });
});

test('容器启动中的细节：等待调度与调度不上、已调度、拉镜像（摘要截短）、节点上已有、拉取失败与退避都记为警告', () => {
  const start = completeStage(initialStartup(t0, { checkout: 'main' }), 'queue', at(1));
  const stage = (observation: StartupObservation) => advanceStartup(start, observation).stages[1]!;
  expect(stage(observed())).toMatchObject({ state: 'running', detail: '等待调度' });
  expect(stage(observed({ unschedulable: { reason: 'Unschedulable', message: '0/1 nodes are available: 1 Insufficient cpu.' } }))).toMatchObject({ detail: '等待调度', warning: '调度不上：0/1 nodes are available: 1 Insufficient cpu.' });
  expect(stage(observed({ node: 'docker-desktop', pulls: [{ container: 'checkout', image: IMAGE, startedAt: at(2), cached: false }] })).detail).toBe('已调度到节点 docker-desktop · 正在拉取镜像 registry.local/crewstation/task@sha256:0123456789ab');
  expect(stage(observed({ node: 'n1', pulls: [{ container: 'checkout', image: IMAGE, startedAt: at(2), endedAt: at(4), cached: false, took: '2.345s' }] })).detail).toBe('已调度到节点 n1 · 镜像已拉取（用时 2.345s） · 创建容器');
  expect(stage(observed({ node: 'n1', pulls: [{ container: 'checkout', endedAt: at(2), cached: true }] })).detail).toBe('已调度到节点 n1 · 镜像节点上已有 · 创建容器');
  expect(stage(observed({ node: 'n1' })).detail).toBe('已调度到节点 n1 · 创建容器');
  const backoff = observed({ node: 'n1', containers: [{ name: 'checkout', init: true, waiting: { reason: 'ImagePullBackOff', message: 'Back-off pulling image' } }, { name: 'task-1', init: false, waiting: { reason: 'PodInitializing' } }] });
  expect(stage(backoff)).toMatchObject({ state: 'running', warning: '镜像拉取失败（ImagePullBackOff）：Back-off pulling image' });
  expect(stage(observed({ node: 'n1', pulls: [{ container: 'checkout', startedAt: at(2), cached: false, failure: 'Failed to pull image: not found' }] })).warning).toBe('镜像拉取失败：Failed to pull image: not found');
  expect(stage(observed({ node: 'n1', containers: [{ name: 'task-1', init: false, waiting: { reason: 'CreateContainerConfigError', message: 'secret not found' } }] })).warning).toBe('容器无法创建（CreateContainerConfigError）：secret not found');
  // 细节没变不产生新记录：观测用例据此不写库。
  const once = advanceStartup(start, observed({ node: 'n1' }));
  expect(advanceStartup(once, observed({ node: 'n1' }))).toBe(once);
});

test('开发会话：init 开始即检出，以 0 退出即等待连接；非 0 退出只记警告不判失败；Pod 没有 init 容器时跳过检出', () => {
  const start = completeStage(initialStartup(t0, { checkout: 'feature/x' }), 'queue', at(1));
  const cloning = advanceStartup(start, observed({ node: 'n1', containers: [{ name: 'checkout', init: true, startedAt: at(4) }, { name: 'task-1', init: false, waiting: { reason: 'PodInitializing' } }] }));
  expect(kinds(cloning)).toEqual(['queue:succeeded', 'container:succeeded', 'checkout:running', 'connect:pending', 'ready:pending']);
  expect(cloning.stages[1]).toMatchObject({ endedAt: at(4), durationMs: 3000 });
  expect(cloning.stages[2]).toMatchObject({ startedAt: at(4), detail: '正在克隆分支 feature/x' });
  const checked = advanceStartup(cloning, observed({ containers: [{ name: 'checkout', init: true, startedAt: at(4), finishedAt: at(7), exitCode: 0 }, { name: 'task-1', init: false, startedAt: at(8) }] }));
  expect(kinds(checked)).toEqual(['queue:succeeded', 'container:succeeded', 'checkout:succeeded', 'connect:running', 'ready:pending']);
  expect(checked.stages[3]).toMatchObject({ startedAt: at(7), detail: '容器已启动，等待 TaskRunner 连接' });
  const broken = advanceStartup(cloning, observed({ containers: [{ name: 'checkout', init: true, startedAt: at(4), finishedAt: at(9), exitCode: 128 }, { name: 'task-1', init: false }] }));
  expect(broken.stages[2]).toMatchObject({ state: 'running', warning: '检出失败（退出码 128）' });
  const noInit = advanceStartup(start, { containers: [{ name: 'task-1', init: false, startedAt: at(5) }], pulls: [] });
  expect(kinds(noInit)).toEqual(['queue:succeeded', 'container:succeeded', 'checkout:skipped', 'connect:running', 'ready:pending']);
  expect(noInit.stages[3]).toMatchObject({ startedAt: at(5), detail: '容器已启动，等待 TaskRunner 连接' });
});

test('完成的段只留结果：容器段写调度到的节点与镜像来源，检出与等待连接去掉进行时的说明，过去的警告一并去掉；失败的段保留现场', () => {
  const start = completeStage(initialStartup(t0, { checkout: 'main' }), 'queue', at(1));
  const started = (patch: Partial<StartupObservation>) => advanceStartup(start, observed({ containers: [{ name: 'checkout', init: true, startedAt: at(4) }, { name: 'task-1', init: false }], ...patch }));
  // 上一轮还没看到 Pulled 事件、写着「创建容器」；完成的这一轮按这一轮的观测写结果（2026-09-23 实机）。
  const creating = advanceStartup(start, observed({ node: 'n1' }));
  expect(creating.stages[1]!.detail).toBe('已调度到节点 n1 · 创建容器');
  const cached = advanceStartup(creating, observed({ node: 'n1', containers: [{ name: 'checkout', init: true, startedAt: at(4) }, { name: 'task-1', init: false }], pulls: [{ container: 'checkout', endedAt: at(3), cached: true }] }));
  expect(cached.stages[1]).toEqual({ kind: 'container', state: 'succeeded', startedAt: at(1), endedAt: at(4), durationMs: 3000, detail: '已调度到节点 n1 · 镜像节点上已有' });
  expect(started({ node: 'n1', pulls: [{ container: 'checkout', startedAt: at(2), endedAt: at(3), cached: false, took: '2.345s' }] }).stages[1]!.detail).toBe('已调度到节点 n1 · 镜像已拉取（用时 2.345s）');
  expect(started({}).stages[1]!.detail).toBeUndefined();
  // 调度不上的警告在排上之后就过去了。
  const waited = advanceStartup(start, observed({ unschedulable: { reason: 'Unschedulable', message: '0/1 nodes are available' } }));
  expect(waited.stages[1]!.warning).toBe('调度不上：0/1 nodes are available');
  expect(advanceStartup(waited, observed({ node: 'n1', containers: [{ name: 'checkout', init: true, startedAt: at(9) }, { name: 'task-1', init: false }] })).stages[1]).not.toHaveProperty('warning');
  const cloning = started({ node: 'n1' });
  expect(cloning.stages[2]!.detail).toBe('正在克隆分支 main');
  const connecting = advanceStartup(cloning, observed({ containers: [{ name: 'checkout', init: true, startedAt: at(4), finishedAt: at(6), exitCode: 0 }, { name: 'task-1', init: false, startedAt: at(7) }] }));
  expect(connecting.stages[2]).toEqual({ kind: 'checkout', state: 'succeeded', subject: 'main', startedAt: at(4), endedAt: at(6), durationMs: 2000 });
  expect(connecting.stages[3]!.detail).toBe('容器已启动，等待 TaskRunner 连接');
  expect(completeThrough(connecting, 'connect', at(8)).stages[3]).toEqual({ kind: 'connect', state: 'succeeded', startedAt: at(6), endedAt: at(8), durationMs: 2000 });
  const failed = failStartup(waited, at(20), { code: 'image-pull-failed', message: '镜像拉取失败' });
  expect(failed.stages[1]).toMatchObject({ state: 'failed', detail: '等待调度', warning: '调度不上：0/1 nodes are available' });
});

test('等待连接：主容器没起来前写「等待主容器启动」，容器起不来记警告；Pod 已在而排队或替换没跟上时按 Pod 创建时间补上', () => {
  const connecting = completeStage(completeStage(initialStartup(t0), 'queue', at(1)), 'container', at(2));
  expect(advanceStartup(connecting, { containers: [{ name: 'task-1', init: false }], pulls: [] }).stages[2]!.detail).toBe('等待主容器启动');
  expect(advanceStartup(connecting, { containers: [{ name: 'task-1', init: false, waiting: { reason: 'CrashLoopBackOff', message: 'back-off 10s' } }], pulls: [] }).stages[2]!.warning).toBe('容器无法启动（CrashLoopBackOff）：back-off 10s');
  const lagging = advanceStartup(initialStartup(t0, { rebuild: true }), { createdAt: at(3), containers: [], pulls: [] });
  expect(kinds(lagging)).toEqual(['queue:succeeded', 'replace:running', 'container:pending', 'connect:pending', 'ready:pending']);
  expect(kinds(advanceStartup(lagging, { createdAt: at(4), containers: [], pulls: [] }))).toEqual(['queue:succeeded', 'replace:succeeded', 'container:running', 'connect:pending', 'ready:pending']);
  // 已结束的进度不再推进。
  const failed = failStartup(connecting, at(3), { code: 'pod-exited', message: 'x' });
  expect(advanceStartup(failed, { containers: [{ name: 'task-1', init: false, startedAt: at(2) }], pulls: [] })).toBe(failed);
});

test('失败、取消与收束：失败落在进行中的段并带日志；握手被拒先收束之前的段；取消把进行中的段记为跳过', () => {
  const containerRunning = completeStage(initialStartup(t0, { checkout: 'main' }), 'queue', at(1));
  const failed = failStartup(containerRunning, at(6), { code: 'image-pull-failed', message: '镜像拉取失败' }, 'tail');
  expect(failed.state).toBe('failed'); expect(failed.endedAt).toBe(at(6));
  expect(failed.stages[1]).toEqual({ kind: 'container', state: 'failed', startedAt: at(1), endedAt: at(6), durationMs: 5000, error: { code: 'image-pull-failed', message: '镜像拉取失败' }, logTail: 'tail' });
  expect(failStartup(failed, at(9), { code: 'pod-exited', message: 'again' })).toBe(failed);
  const rejected = failAtStage(containerRunning, 'connect', at(8), { code: 'runner-protocol-mismatch', message: '协议不一致' });
  expect(kinds(rejected)).toEqual(['queue:succeeded', 'container:succeeded', 'checkout:succeeded', 'connect:failed', 'ready:pending']);
  const cancelled = cancelStartup(containerRunning, at(4));
  expect(cancelled.state).toBe('cancelled');
  expect(cancelled.stages[1]).toMatchObject({ state: 'skipped', endedAt: at(4), durationMs: 3000 });
  expect(cancelStartup(failed, at(9))).toBe(failed);
  const through = completeThrough(containerRunning, 'connect', at(9));
  expect(through.state).toBe('ready');
  expect(completeThrough(containerRunning, 'container', at(9)).stages.map((stage) => stage.state)).toEqual(['succeeded', 'succeeded', 'running', 'pending', 'pending']);
});

test('失败归类：Pod 在检出时退出是检出失败、在容器起来之前退出是容器起不来；没有给归类时按进行中的段给', () => {
  const containerRunning = completeStage(initialStartup(t0, { checkout: 'main' }), 'queue', at(1));
  const checkoutRunning = completeStage(containerRunning, 'container', at(2));
  expect(failureCode(checkoutRunning, 'pod-exited')).toBe('checkout-failed');
  expect(failureCode(containerRunning, 'pod-exited')).toBe('container-start-failed');
  expect(failureCode(containerRunning, 'image-pull-failed')).toBe('image-pull-failed');
  expect(failureCode(undefined, 'pod-missing')).toBe('pod-missing');
  expect([initialStartup(t0), containerRunning, checkoutRunning, completeStage(checkoutRunning, 'checkout', at(3))].map(defaultFailureCode)).toEqual(['admission-rejected', 'container-start-failed', 'checkout-failed', 'pod-exited']);
  expect(defaultFailureCode(completeStage(initialStartup(t0, { rebuild: true }), 'queue', at(1)))).toBe('replace-failed');
  expect(runningStage(undefined)).toBeUndefined();
});

test('环境状态迁移顺带收束启动进度：连上即就绪、失败即失败、释放或暂停即取消；补丁里写好的原样保留', () => {
  const env = { id: 'task', state: 'creating', startup: completeStage(initialStartup(t0), 'queue', at(1)) } as unknown as TaskEnvironment;
  expect(transition(env, 'running', new Date(at(5))).startup!.state).toBe('ready');
  const failed = transition(env, 'failed', new Date(at(5)), { message: '容器不存在' }).startup!;
  expect(failed.stages[1]).toMatchObject({ state: 'failed', error: { code: 'container-start-failed', message: '容器不存在' } });
  expect(transition(env, 'releasing', new Date(at(5))).startup!.state).toBe('cancelled');
  const explicit = failStartup(env.startup!, at(4), { code: 'pod-create-failed', message: 'quota' });
  expect(transition(env, 'failed', new Date(at(5)), { startup: explicit }).startup).toBe(explicit);
  const legacy = { id: 'old', state: 'creating' } as unknown as TaskEnvironment;
  expect(transition(legacy, 'running', new Date(at(5))).startup).toBeUndefined();
});
