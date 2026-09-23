import { afterEach, describe, expect, test } from 'bun:test';
import type { StartupRecord, TaskId, UserId } from '@crewstation/contracts';
import type { K8sObject } from '@crewstation/k8s';
import { Resources } from '@crewstation/k8s';
import { newId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { drizzleEnvironmentRepository } from '../adapters/persistence/drizzleRepositories';
import type { CreateNativeExecutionInput } from '../api/moduleApi';
import { rebuildFixture } from './rebuildFixture';
import type { TaskEnvironment } from '../domain/taskEnvironment';
import { POD_CREATE_GRACE_MS } from '../domain/taskEnvironment';

const available = await testDatabaseAvailable();
let f: Awaited<ReturnType<typeof rebuildFixture>> | undefined;
afterEach(async () => { await f?.close(); f = undefined; });

const NS = 'cs-qa';
const kinds = (startup: StartupRecord | undefined) => startup?.stages.map((stage) => `${stage.kind}:${stage.state}`);
const startupOf = async (id: TaskId) => (await f!.uow.read.environments.getById(id))!.startup!;
const patchPod = (name: string, patch: Record<string, unknown>) => f!.k8s.mergePatch(Resources.Pod!, name, NS, patch);
const tokenOf = async (podName: string) => {
  const pod = (await f!.k8s.get(Resources.Pod!, podName, NS))!;
  return (pod.spec as { containers: Array<{ env: Array<{ name: string; value: string }> }> }).containers[0]!.env.find((v) => v.name === 'CS_RUNNER_TOKEN')!.value;
};
const text = (body: string) => new ReadableStream<Uint8Array>({ start: (c) => { c.enqueue(new TextEncoder().encode(body)); c.close(); } });
const devSession = async (branch: string) => {
  f = await rebuildFixture({ kind: 'business', running: true });
  f.state.quota = 5;
  return f.runtime.api.createEnvironment({ serviceId: f.serviceId, kind: 'dev-session', branch });
};

describe.skipIf(!available)('启动进度（RFC-022）', () => {
  test('开发会话：建出 Pod 即容器启动中；观测按 Pod 自己记的时间推进调度、拉镜像、检出与等待连接；连上即就绪；观测不改 updatedAt', async () => {
    const dev = await devSession('feature/x');
    expect(kinds(await startupOf(dev.id))).toEqual(['queue:succeeded', 'container:running', 'checkout:pending', 'connect:pending', 'ready:pending']);
    expect((await startupOf(dev.id)).stages[2]!.subject).toBe('feature/x');
    const pod = (await f!.k8s.get(Resources.Pod!, dev.podName, NS))!;
    await patchPod(dev.podName, { spec: { nodeName: 'worker-one' }, status: { phase: 'Pending', conditions: [{ type: 'PodScheduled', status: 'True', lastTransitionTime: '2026-09-15T10:00:02Z' }] } });
    await f!.k8s.create({ apiVersion: 'v1', kind: 'Event', metadata: { name: 'pulling', namespace: NS }, involvedObject: { uid: pod.metadata.uid, fieldPath: 'spec.initContainers{checkout}' },
      reason: 'Pulling', message: 'Pulling image "task:current"', firstTimestamp: '2026-09-15T10:00:03Z', lastTimestamp: '2026-09-15T10:00:03Z' } as K8sObject);
    // 别的 Pod 的事件不算进来。
    await f!.k8s.create({ apiVersion: 'v1', kind: 'Event', metadata: { name: 'other', namespace: NS }, involvedObject: { uid: 'other-pod', fieldPath: 'spec.initContainers{checkout}' }, reason: 'Pulled', message: 'Container image "x" already present on machine' } as K8sObject);
    const before = (await f!.uow.read.environments.getById(dev.id))!.updatedAt;
    expect(await f!.runtime.api.observeStartup()).toBe(1);
    expect((await startupOf(dev.id)).stages[1]).toMatchObject({ state: 'running', detail: '已调度到节点 worker-one · 正在拉取镜像 task:current' });
    expect((await f!.uow.read.environments.getById(dev.id))!.updatedAt).toEqual(before);
    expect(await f!.runtime.api.observeStartup()).toBe(0);

    await patchPod(dev.podName, { status: { initContainerStatuses: [{ name: 'checkout', state: { running: { startedAt: '2026-09-15T10:00:05Z' } } }] } });
    await f!.runtime.api.observeStartup();
    const cloning = await startupOf(dev.id);
    expect(kinds(cloning)).toEqual(['queue:succeeded', 'container:succeeded', 'checkout:running', 'connect:pending', 'ready:pending']);
    expect(cloning.stages[1]!.endedAt).toBe('2026-09-15T10:00:05.000Z');
    expect(cloning.stages[2]).toMatchObject({ startedAt: '2026-09-15T10:00:05.000Z', detail: '正在克隆分支 feature/x' });

    await patchPod(dev.podName, { status: { phase: 'Running', initContainerStatuses: [{ name: 'checkout', state: { terminated: { startedAt: '2026-09-15T10:00:05Z', finishedAt: '2026-09-15T10:00:09Z', exitCode: 0, reason: 'Completed' } } }],
      containerStatuses: [{ name: dev.podName, state: { running: { startedAt: '2026-09-15T10:00:10Z' } } }] } });
    await f!.runtime.api.observeStartup();
    const connecting = await startupOf(dev.id);
    expect(kinds(connecting)).toEqual(['queue:succeeded', 'container:succeeded', 'checkout:succeeded', 'connect:running', 'ready:pending']);
    expect(connecting.stages[2]).toMatchObject({ endedAt: '2026-09-15T10:00:09.000Z', durationMs: 4000 });
    expect(connecting.stages[3]!.detail).toBe('容器已启动，等待 TaskRunner 连接');

    expect(await f!.runtime.api.onRunnerConnected(dev.id, await tokenOf(dev.podName))).toBe(true);
    const ready = await startupOf(dev.id);
    expect(ready.state).toBe('ready');
    expect(kinds(ready)).toEqual(['queue:succeeded', 'container:succeeded', 'checkout:succeeded', 'connect:succeeded', 'ready:succeeded']);
    expect((await f!.runtime.api.getEnvironment(dev.id))!.startup).toEqual(ready);
    expect(await f!.runtime.api.observeStartup()).toBe(0);
  });

  test('检出失败：Pod 失败即判定，停在检出代码，带归类与打码后的 init 容器日志尾部', async () => {
    const dev = await devSession('gone');
    const asked: Array<string | undefined> = [];
    f!.k8s.logs = async (_namespace, _pod, options) => { asked.push(options?.container); return text("Cloning into '/work'...\nfatal: unable to access 'https://oauth2:tok-secret@git.invalid/qa.git/': Remote branch gone not found\n克隆失败，已重试 3 次\n"); };
    await patchPod(dev.podName, { spec: { nodeName: 'worker-one' }, status: { phase: 'Failed', initContainerStatuses: [{ name: 'checkout', state: { terminated: { startedAt: '2026-09-15T10:00:05Z', finishedAt: '2026-09-15T10:00:19Z', exitCode: 128, reason: 'Error' } } }] } });
    expect(await f!.runtime.api.observeStartup()).toBe(1);
    const env = (await f!.uow.read.environments.getById(dev.id))!;
    expect(env.state).toBe('failed');
    expect(kinds(env.startup)).toEqual(['queue:succeeded', 'container:succeeded', 'checkout:failed', 'connect:pending', 'ready:pending']);
    const failed = env.startup!.stages[2]!;
    expect(failed.error?.code).toBe('checkout-failed');
    expect(failed.error?.message).toContain('checkout：Error，退出码 128');
    expect(asked).toEqual(['checkout']);
    expect(failed.logTail).toContain('https://***@git.invalid/qa.git');
    expect(failed.logTail).not.toContain('tok-secret');
  });

  test('握手被拒一定在等待连接：之前的段先收束，环境状态不变；启动中释放记为已取消', async () => {
    const dev = await devSession('main');
    await f!.runtime.api.onRunnerRejected(dev.id, await tokenOf(dev.podName), { code: 'protocol_mismatch', runnerProtocol: 2, message: 'Runner 协议 2 与平台 3 不一致' });
    const env = (await f!.uow.read.environments.getById(dev.id))!;
    expect(env.state).toBe('creating');
    expect(kinds(env.startup)).toEqual(['queue:succeeded', 'container:succeeded', 'checkout:succeeded', 'connect:failed', 'ready:pending']);
    expect(env.startup!.stages[3]!.error).toEqual({ code: 'runner-protocol-mismatch', message: 'Runner 协议 2 与平台 3 不一致' });

    const business = await f!.runtime.api.createEnvironment({ serviceId: f!.serviceId, kind: 'business' });
    await f!.runtime.api.releaseEnvironment(business.id, 'business');
    const released = await startupOf(business.id);
    expect(released.state).toBe('cancelled');
    expect(kinds(released)).toEqual(['queue:succeeded', 'container:skipped', 'connect:pending', 'ready:pending']);
  });

  test('执行环境：排队到建出 Pod，拉不到镜像立即判失败并回收；另一个连上即就绪', async () => {
    f = await rebuildFixture({ running: true });
    f.state.quota = 4;
    const input = (): CreateNativeExecutionInput => ({ id: newId('tsk') as TaskId, parentTaskId: f!.env.id, createdBy: '01a0bf5d-8f4b-7ed2-8386-a4b2e1a36efb' as UserId,
      agentId: newId('agt'), terminalId: newId('pty'), runnerId: crypto.randomUUID(), fingerprint: 'f'.repeat(64), profile: '01a0bf5d-8f4b-7001-8458-107366e7de39' });
    const broken = await f.runtime.api.createNativeExecution(input()), fine = await f.runtime.api.createNativeExecution(input());
    expect(kinds(broken.startup)).toEqual(['queue:running', 'container:pending', 'connect:pending', 'ready:pending']);
    await f.runNative(); await f.runNative();
    expect(kinds(await startupOf(broken.id))).toEqual(['queue:succeeded', 'container:running', 'connect:pending', 'ready:pending']);
    const brokenPod = (await f.uow.read.environments.getById(broken.id))!.podName, finePod = (await f.uow.read.environments.getById(fine.id))!.podName;
    await patchPod(brokenPod, { status: { phase: 'Pending', containerStatuses: [{ name: brokenPod, state: { waiting: { reason: 'ErrImagePull', message: 'manifest unknown' } } }] } });
    await patchPod(finePod, { status: { phase: 'Running', containerStatuses: [{ name: finePod, state: { running: { startedAt: '2026-09-15T10:00:07Z' } } }] } });
    await f.runtime.api.observeStartup();
    const failed = (await f.uow.read.environments.getById(broken.id))!;
    expect(failed.native?.state).toBe('cleaning');
    expect(kinds(failed.startup)).toEqual(['queue:succeeded', 'container:failed', 'connect:pending', 'ready:pending']);
    expect(failed.startup!.stages[1]!.error?.code).toBe('image-pull-failed');
    expect(failed.startup!.stages[1]!.logTail).toBeUndefined();
    expect(kinds(await startupOf(fine.id))).toEqual(['queue:succeeded', 'container:succeeded', 'connect:running', 'ready:pending']);
    const secret = (await f.k8s.get(Resources.Secret!, `${finePod}-runner`, NS))!;
    expect(await f.runtime.api.onRunnerConnected(fine.id, (secret.stringData as Record<string, string>).CS_RUNNER_TOKEN!)).toBe(true);
    expect((await startupOf(fine.id)).state).toBe('ready');
    // 主容器日志留证只读执行环境自己的主容器。
    f.k8s.logs = async (_namespace, pod, options) => text(`${pod}/${options?.container}\n`);
    expect(await f.runtime.api.captureStartupLog(fine.id)).toBe(`${finePod}/${finePod}\n`);
    expect(await f.runtime.api.captureStartupLog(newId('tsk') as TaskId)).toBeUndefined();
  });

  test('重建：重置为重建的五段，作业开始替换即「替换旧容器」，建出新 Pod 即容器启动中；之前的启动过程被替换', async () => {
    f = await rebuildFixture();
    expect((await startupOf(f.env.id)).state).toBe('failed');
    await f.runtime.api.requestRebuild(f.projectId, await f.request());
    expect(kinds(await startupOf(f.env.id))).toEqual(['queue:running', 'replace:pending', 'container:pending', 'connect:pending', 'ready:pending']);
    await f.run();
    expect(kinds(await startupOf(f.env.id))).toEqual(['queue:succeeded', 'replace:succeeded', 'container:running', 'connect:pending', 'ready:pending']);
  });

  test('只取启动中的环境，按 id 翻页', async () => {
    f = await rebuildFixture({ kind: 'business', running: true });
    f.state.quota = 5;
    const a = await f.runtime.api.createEnvironment({ serviceId: f.serviceId, kind: 'business' }), b = await f.runtime.api.createEnvironment({ serviceId: f.serviceId, kind: 'business' });
    const repo = drizzleEnvironmentRepository(f.tdb.db), [first, second] = [a.id, b.id].sort() as [TaskId, TaskId];
    expect((await repo.listStarting({ limit: 1 })).map((env) => env.id)).toEqual([first]);
    expect((await repo.listStarting({ after: first, limit: 5 })).map((env) => env.id)).toEqual([second]);
    expect((await repo.listStarting({ limit: 5 })).map((env) => env.id)).not.toContain(f.env.id);
  });
  /** 建 Pod 卡在 Kubernetes 那一步：记录已提交、Pod 还没建出来（2026-09-23 实机撞上的空档）。 */
  const creatingWithoutPod = async () => {
    f = await rebuildFixture({ kind: 'business', running: true });
    f.state.quota = 5;
    const create = f.k8s.create.bind(f.k8s);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    f.k8s.create = (async (object: K8sObject) => { if (object.kind === 'Pod') await gate; return create(object); }) as typeof f.k8s.create;
    const pending = f.runtime.api.createEnvironment({ serviceId: f.serviceId, kind: 'dev-session', branch: 'main' });
    let dev: TaskEnvironment | undefined;
    for (let i = 0; i < 200 && !dev; i++) { dev = (await f.uow.read.environments.listByStates(['creating'])).find((env) => env.kind === 'dev-session'); if (!dev) await Bun.sleep(5); }
    return { dev: dev!, pending, release };
  };

  test('记录先于 Pod 提交：Pod 还没建出来时，每秒观测与对账都不判「容器不存在」；建出后照常推进', async () => {
    const { dev, pending, release } = await creatingWithoutPod();
    expect(await f!.runtime.api.observeStartup()).toBe(0);
    await f!.runtime.api.reconcile();
    expect((await f!.uow.read.environments.getById(dev.id))!.state).toBe('creating');
    release();
    await pending;
    expect(kinds(await startupOf(dev.id))).toEqual(['queue:succeeded', 'container:running', 'checkout:pending', 'connect:pending', 'ready:pending']);
  });

  test('超过两分钟仍没有 Pod（建 Pod 的进程中途没了）：照旧判容器不存在，停在排队', async () => {
    const { dev, pending, release } = await creatingWithoutPod();
    f!.advance(POD_CREATE_GRACE_MS);
    expect(await f!.runtime.api.observeStartup()).toBe(1);
    const failed = (await f!.uow.read.environments.getById(dev.id))!;
    expect(failed.state).toBe('failed');
    expect(failed.startup!.stages[0]).toMatchObject({ kind: 'queue', state: 'failed', error: { code: 'pod-missing' } });
    release();
    await pending;
  });
});
