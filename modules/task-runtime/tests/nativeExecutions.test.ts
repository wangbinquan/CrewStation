import { afterEach, describe, expect, test } from 'bun:test';
import type { TaskId, UserId } from '@crewstation/contracts';
import { Resources } from '@crewstation/k8s';
import { newId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import type { CreateNativeExecutionInput } from '../api/moduleApi';
import { rebuildFixture } from './rebuildFixture';

const available = await testDatabaseAvailable();
let f: Awaited<ReturnType<typeof rebuildFixture>> | undefined;
afterEach(async () => { await f?.close(); f = undefined; });
const input = (parentTaskId: TaskId): CreateNativeExecutionInput => ({ id: newId('tsk') as TaskId, parentTaskId, createdBy: `usr_${'c'.repeat(32)}` as UserId,
  agentId: newId('agt'), terminalId: newId('pty'), runnerId: crypto.randomUUID(), fingerprint: 'f'.repeat(64), profile: 'coding-medium' });
async function childToken(id: TaskId): Promise<string> {
  const child = (await f!.uow.read.environments.getById(id))!;
  const secret = (await f!.k8s.get(Resources.Secret!, `${child.podName}-runner`, child.namespace))!;
  return (secret.stringData as Record<string, string>).CS_RUNNER_TOKEN!;
}

describe.skipIf(!available)('逐 CLI 独立执行环境', () => {
  test('原子受理、共享原卷、独立资源、冻结配置，原工作区身份与预览保持', async () => {
    f = await rebuildFixture({ running: true }); f.state.quota = 4;
    const { runtime, env, projectId, k8s } = f, request = input(env.id);
    const before = structuredClone([...k8s.objects]);
    const [a, b] = await Promise.all([runtime.api.createNativeExecution(request), runtime.api.createNativeExecution({ ...request })]);
    expect(a).toEqual(b); expect(a.native?.state).toBe('queued');
    expect(await runtime.api.runningTaskCount(projectId)).toBe(2);
    expect([...k8s.objects]).toEqual(before);
    f.state.profiles[0]!.memory = '8Gi';
    await runtime.api.reconcile();
    expect((await runtime.api.getEnvironment(a.id))?.state).toBe('creating');
    await f.runNative();
    const current = (await f.uow.read.environments.getById(a.id))!, n = current.native!;
    expect(n).toMatchObject({ state: 'starting', profile: { memory: '2Gi' }, parentTaskId: env.id });
    const pod = (await k8s.get(Resources.Pod!, current.podName, env.namespace))!;
    expect(pod.spec).toMatchObject({ containers: [{ image: 'task:current', env: [], resources: { requests: { cpu: '1', memory: '2Gi', 'ephemeral-storage': '10Gi' }, limits: { cpu: '1', memory: '2Gi', 'ephemeral-storage': '10Gi' } } }],
      volumes: [{ name: 'work', persistentVolumeClaim: { claimName: env.pvcName } }], affinity: { nodeAffinity: { requiredDuringSchedulingIgnoredDuringExecution: { nodeSelectorTerms: [{ matchFields: [{ key: 'metadata.name', values: ['worker-one'] }] }] } } } });
    expect((pod.spec as Record<string, unknown>).initContainers).toBeUndefined();
    const secret = (await k8s.get(Resources.Secret!, `${current.podName}-runner`, env.namespace))!;
    expect(secret.stringData).toMatchObject({ CS_TASK_ID: env.id, CS_RUNNER_TASK_ID: current.id, CS_RUNNER_NATIVE_ID: request.runnerId, CS_ENVIRONMENT: 'development' });
    expect((secret.stringData as Record<string, string>).CS_PREVIEW_COMMAND).toBeUndefined();
    expect(await runtime.api.onRunnerConnected(a.id, await childToken(a.id))).toBe(true);
    expect(await runtime.api.findDevSession(projectId)).toMatchObject({ id: env.id, state: 'running' });
    expect((await runtime.api.listRunningDevSessions()).map((item) => item.id)).toEqual([env.id]);
    expect(f.state.checkoutCalls).toBe(1);
    for (const [key, object] of before) expect(k8s.objects.get(key)).toEqual(object);
    expect(JSON.stringify(current)).not.toContain(await childToken(a.id));
  });

  test('同一请求不能改配置，两个不同窗口争夺最后额度只启动一个', async () => {
    f = await rebuildFixture({ running: true }); const { runtime, env, projectId } = f;
    const a = input(env.id), b = input(env.id);
    const outcomes = await Promise.allSettled([runtime.api.createNativeExecution(a), runtime.api.createNativeExecution(b)]);
    expect(outcomes.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((item) => item.status === 'rejected')).toMatchObject([{ reason: { kind: 'quota_exceeded' } }]);
    const accepted = outcomes[0]!.status === 'fulfilled' ? a : b;
    for (const patch of [{ fingerprint: 'b'.repeat(64) }, { runnerId: crypto.randomUUID() }, { profile: 'coding-large' }, { agentId: 'another' }]) {
      await expect(runtime.api.createNativeExecution({ ...accepted, ...patch })).rejects.toMatchObject({ kind: 'conflict' });
    }
    expect(await runtime.api.runningTaskCount(projectId)).toBe(2);
    expect((await runtime.api.createNativeExecution(accepted)).id).toBe(accepted.id);
  });

  test('一个子 Pod OOM 后清理自身并只释放一次额度，原容器与其他 CLI 不变', async () => {
    f = await rebuildFixture({ running: true }); f.state.quota = 4;
    const { runtime, env, k8s, projectId } = f;
    const a = await runtime.api.createNativeExecution(input(env.id)), b = await runtime.api.createNativeExecution(input(env.id));
    await f.runNative(); await f.runNative();
    await runtime.api.onRunnerConnected(a.id, await childToken(a.id)); await runtime.api.onRunnerConnected(b.id, await childToken(b.id));
    const other = structuredClone(await k8s.get(Resources.Pod!, b.podName, env.namespace)), root = structuredClone(await k8s.get(Resources.Pod!, env.podName, env.namespace));
    await k8s.mergePatch(Resources.Pod!, a.podName, env.namespace, { status: { phase: 'Failed', containerStatuses: [{ name: a.podName, state: { terminated: { reason: 'OOMKilled', exitCode: 137 } } }] } });
    await runtime.api.reconcile();
    expect(await runtime.api.runningTaskCount(projectId)).toBe(3);
    expect(await runtime.api.getEnvironment(a.id)).toMatchObject({ state: 'releasing', native: { state: 'cleaning' } });
    await f.runNative(); await runtime.api.reconcile(); await f.runNative();
    expect(await runtime.api.getEnvironment(a.id)).toMatchObject({ state: 'failed', native: { state: 'finished' } });
    expect((await runtime.api.getEnvironment(a.id))?.message).toContain('OOMKilled');
    expect(await runtime.api.runningTaskCount(projectId)).toBe(2);
    expect(await k8s.get(Resources.Pod!, b.podName, env.namespace)).toEqual(other);
    expect(await k8s.get(Resources.Pod!, env.podName, env.namespace)).toEqual(root);
    expect(await k8s.get(Resources.PersistentVolumeClaim!, env.pvcName, env.namespace)).toBeDefined();
  });

  test('调度超时保留具体原因，失败请求不自动新建执行容器', async () => {
    f = await rebuildFixture({ running: true }); const request = input(f.env.id);
    const child = await f.runtime.api.createNativeExecution(request); await f.runNative();
    await f.k8s.mergePatch(Resources.Pod!, child.podName, f.env.namespace, { status: { phase: 'Pending', conditions: [{ type: 'PodScheduled', status: 'False', message: 'Insufficient cpu' }] } });
    await f.runtime.api.reconcile();
    expect((await f.runtime.api.getEnvironment(child.id))?.message).toContain('Insufficient cpu');
    f.advance(5 * 60_000 + 1); await f.runtime.api.reconcile(); await f.runNative();
    const failed = await f.runtime.api.createNativeExecution(request);
    expect(failed).toMatchObject({ id: child.id, state: 'failed', native: { state: 'finished' } });
    expect(failed.message).toContain('Insufficient cpu');
    expect(await f.runtime.api.runningTaskCount(f.projectId)).toBe(1);
    expect(await f.k8s.get(Resources.Pod!, child.podName, f.env.namespace)).toBeUndefined();
  });

  test('父释放先拦住新窗口，子容器全部消失后才删除父工作卷', async () => {
    f = await rebuildFixture({ running: true }); f.state.quota = 4;
    const { runtime, env, projectId, k8s } = f;
    const child = await runtime.api.createNativeExecution(input(env.id)); await f.runNative();
    await runtime.api.onRunnerConnected(child.id, await childToken(child.id));
    const token = await childToken(child.id);
    expect(await runtime.api.releaseEnvironment(env.id, 'user')).toMatchObject({ state: 'releasing' });
    await expect(runtime.api.createNativeExecution(input(env.id))).rejects.toMatchObject({ kind: 'precondition' });
    expect(await runtime.api.onRunnerConnected(child.id, token)).toBe(false);
    expect(await k8s.get(Resources.PersistentVolumeClaim!, env.pvcName, env.namespace)).toBeDefined();
    for (let i = 0; i < 4; i++) await f.nextNativeAttempt();
    expect(await runtime.api.getEnvironment(env.id)).toMatchObject({ state: 'released' });
    expect(await runtime.api.getEnvironment(child.id)).toMatchObject({ state: 'released', native: { state: 'finished' } });
    expect(await runtime.api.runningTaskCount(projectId)).toBe(0);
    expect(k8s.deleted.findIndex((key) => key.endsWith(child.podName))).toBeLessThan(k8s.deleted.findIndex((key) => key.endsWith(env.pvcName)));
    expect(await k8s.get(Resources.PersistentVolumeClaim!, env.pvcName, env.namespace)).toBeUndefined();
    await runtime.api.releaseEnvironment(child.id, 'user'); await runtime.api.releaseEnvironment(env.id, 'user');
    expect(await runtime.api.runningTaskCount(projectId)).toBe(0);
  });

  test('父容器故障后子 CLI 保持，保卷重建必须仍在子容器所在节点', async () => {
    f = await rebuildFixture({ running: true }); f.state.quota = 4;
    const { runtime, env, k8s } = f;
    const child = await runtime.api.createNativeExecution(input(env.id)); await f.runNative();
    const childCredential = await childToken(child.id);
    await runtime.api.onRunnerConnected(child.id, childCredential);
    const before = structuredClone(await k8s.get(Resources.Pod!, child.podName, env.namespace));
    await k8s.mergePatch(Resources.Pod!, env.podName, env.namespace, { status: { phase: 'Failed', reason: 'OOMKilled' } });
    await runtime.api.reconcile();
    expect(await runtime.api.getEnvironment(child.id)).toMatchObject({ state: 'running', connected: true });
    const rebuild = await runtime.api.requestRebuild(f.projectId, await f.request()); await f.run();
    const recovered = (await runtime.api.getEnvironment(env.id))!;
    expect((await k8s.get(Resources.Pod!, recovered.podName, env.namespace))?.spec).toMatchObject({ affinity: { nodeAffinity: { requiredDuringSchedulingIgnoredDuringExecution: { nodeSelectorTerms: [{ matchFields: [{ values: ['worker-one'] }] }] } } } });
    expect((await f.uow.read.rebuilds.get(rebuild.requestId))?.nodeName).toBe('worker-one');
    expect(await k8s.get(Resources.Pod!, child.podName, env.namespace)).toEqual(before);
    expect(await runtime.api.onRunnerConnected(child.id, childCredential)).toBe(true);
  });
});
