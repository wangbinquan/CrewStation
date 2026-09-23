import { afterEach, describe, expect, test } from 'bun:test';
import type { TaskId, UserId } from '@crewstation/contracts';
import type { K8sObject } from '@crewstation/k8s';
import { Resources } from '@crewstation/k8s';
import { newId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import type { CreateNativeExecutionInput } from '../api/moduleApi';
import { RUNNER_UNAVAILABLE_HINT } from '../domain/podStartup';
import { rebuildFixture } from './rebuildFixture';

const available = await testDatabaseAvailable();
let f: Awaited<ReturnType<typeof rebuildFixture>> | undefined;
afterEach(async () => { await f?.close(); f = undefined; });
const image = `registry.local:5000/runtime/glm@sha256:${'b'.repeat(64)}`;
const agentInput = (patch: Partial<CreateNativeExecutionInput> = {}): CreateNativeExecutionInput => ({ id: newId('tsk') as TaskId, parentTaskId: f!.env.id, purpose: 'agent',
  createdBy: '01a0bf5d-8f4b-7e44-886a-b79b12465703' as UserId, agentId: newId('agt'), runnerId: crypto.randomUUID(), fingerprint: 'a'.repeat(64), image, computeProfile: { profileId: '01a0bf5d-8f4b-7d07-8915-fe618b9d832d', revision: 3 }, ...patch });
type PodSpec = { containers: Array<{ image: string; command: string[]; securityContext: { runAsUser: number }; envFrom: unknown }>; volumes: Array<{ persistentVolumeClaim?: { claimName: string } }> };
const runnerToken = async (child: { podName: string }): Promise<string> => {
  const secret = [...f!.k8s.objects.values()].find((o) => o.kind === 'Secret' && (o as K8sObject & { stringData?: Record<string, string> }).stringData?.CS_RUNNER_TASK_ID !== undefined && o.metadata.name.includes(child.podName.slice(4, 16)))
    ?? [...f!.k8s.objects.values()].filter((o) => o.kind === 'Secret').at(-1)!;
  return (secret as K8sObject & { stringData: Record<string, string> }).stringData.CS_RUNNER_TOKEN!;
};

describe.skipIf(!available)('Agent 执行环境（RFC-006 §5：每个 Agent 一个 Pod）', () => {
  test('headless Agent：档位镜像按摘要、显式 Runner 命令、挂父工作卷、独立占额；没有终端；额度满与父任务不符各有原因', async () => {
    f = await rebuildFixture({ running: true });
    const child = await f.runtime.api.createNativeExecution(agentInput());
    expect(child).toMatchObject({ kind: 'dev-session', podName: `agt-${child.id.replaceAll('-', '')}`, native: { purpose: 'agent', parentTaskId: f.env.id, state: 'queued' } });
    expect(child.native).not.toHaveProperty('terminalId');
    await f.runNative();
    const pod = (await f.k8s.get(Resources.Pod!, child.podName, f.env.namespace))!;
    const spec = pod.spec as PodSpec;
    expect(spec.containers[0]).toMatchObject({ image, command: ['/usr/bin/tini', '--', '/opt/crewstation/bin/task-runner'], securityContext: { runAsUser: 0 } });
    expect(spec.volumes.some((v) => v.persistentVolumeClaim?.claimName === f!.env.pvcName)).toBe(true);
    expect(await f.runtime.api.runningTaskCount(f.projectId)).toBe(2);
    await expect(f.runtime.api.createNativeExecution(agentInput())).rejects.toMatchObject({ kind: 'quota_exceeded', message: expect.stringContaining('本次 Agent 未启动') });
    await expect(f.runtime.api.createNativeExecution(agentInput({ purpose: 'subtask' }))).rejects.toMatchObject({ kind: 'precondition', message: expect.stringContaining('业务任务容器未连接') });
    // 同一执行标识换用途视为另一份启动配置。
    await expect(f.runtime.api.createNativeExecution({ ...agentInput(), id: child.id, purpose: 'cli', terminalId: newId('pty') })).rejects.toMatchObject({ kind: 'conflict' });
  });

  test('Runner 握手被拒（旧底座）：执行环境回收并写明原因、释放额度；开发会话本身只记原因，状态不变', async () => {
    f = await rebuildFixture({ running: true });
    const child = await f.runtime.api.createNativeExecution(agentInput());
    await f.runNative();
    const token = await runnerToken(child);
    const reason = 'Runner 协议版本 1，平台要求 2；请基于当前平台底座镜像重建镜像';
    await f.runtime.api.onRunnerRejected(child.id, token, { code: 'protocol_mismatch', runnerProtocol: 1, message: reason });
    expect(await f.runtime.api.getEnvironment(child.id)).toMatchObject({ state: 'releasing', native: { state: 'cleaning' }, message: reason });
    await f.runNative();
    expect(await f.runtime.api.getEnvironment(child.id)).toMatchObject({ state: 'failed', native: { state: 'finished', failureReason: reason } });
    expect(await f.runtime.api.runningTaskCount(f.projectId)).toBe(1);
    await f.runtime.api.onRunnerRejected(f.env.id, f.token, { code: 'protocol_mismatch', runnerProtocol: 1, message: reason });
    expect(await f.runtime.api.getEnvironment(f.env.id)).toMatchObject({ state: 'running', message: reason });
  });

  test('对账：执行容器拉不到镜像或起不来就立即失败回收，原因区分镜像与底座', async () => {
    f = await rebuildFixture({ running: true });
    f.state.quota = 3;
    const pull = await f.runtime.api.createNativeExecution(agentInput());
    const start = await f.runtime.api.createNativeExecution(agentInput());
    await f.runNative(); await f.runNative();
    await f.k8s.mergePatch(Resources.Pod!, pull.podName, f.env.namespace, { status: { phase: 'Pending', containerStatuses: [{ name: 'task', state: { waiting: { reason: 'ImagePullBackOff' } } }] } });
    await f.k8s.mergePatch(Resources.Pod!, start.podName, f.env.namespace, { status: { phase: 'Pending', containerStatuses: [{ name: 'task', state: { waiting: { reason: 'CreateContainerError' } } }] } });
    await f.runtime.api.reconcile();
    expect((await f.runtime.api.getEnvironment(pull.id))?.message).toContain('此Agent的镜像拉取失败（ImagePullBackOff）');
    expect((await f.runtime.api.getEnvironment(start.id))?.message).toContain(RUNNER_UNAVAILABLE_HINT);
    expect((await f.runtime.api.getEnvironment(start.id))?.native?.state).toBe('cleaning');
  });

  test('业务子任务：父任务必须是业务任务；暂停时结束全部子任务执行环境，恢复时不重起（P7）', async () => {
    f = await rebuildFixture({ running: true, kind: 'business' });
    f.state.quota = 3;
    const child = await f.runtime.api.createNativeExecution(agentInput({ purpose: 'subtask', createdBy: undefined }));
    expect(child).toMatchObject({ kind: 'business', podName: `sub-${child.id.replaceAll('-', '')}`, native: { purpose: 'subtask' } });
    await expect(f.runtime.api.createNativeExecution(agentInput({ purpose: 'agent' }))).rejects.toMatchObject({ kind: 'precondition' });
    await f.runNative();
    // 业务任务与子任务执行环境的 Pod 用网关身份索引与项目出站策略认的工作负载名，Agent 才能访问模型端点。
    const parentPod = (await f.k8s.get(Resources.Pod!, f.env.podName, f.env.namespace))!, childPod = (await f.k8s.get(Resources.Pod!, child.podName, f.env.namespace))!;
    expect([parentPod.metadata.labels?.['crewstation.io/workload'], childPod.metadata.labels?.['crewstation.io/workload']]).toEqual(['business-task', 'business-task']);
    await f.runtime.api.pauseEnvironment(f.env.id);
    expect(await f.runtime.api.getEnvironment(child.id)).toMatchObject({ native: { state: 'cleaning', failureReason: '业务任务已暂停，此子任务的执行环境随之结束' } });
    await f.runNative();
    expect((await f.runtime.api.getEnvironment(child.id))?.native?.state).toBe('finished');
    expect(await f.runtime.api.runningTaskCount(f.projectId)).toBe(0);
    await f.runtime.api.resumeEnvironment(f.env.id);
    expect((await f.runtime.api.getEnvironment(child.id))?.native?.state).toBe('finished');
    expect([...f.k8s.objects.values()].filter((o) => o.kind === 'Pod' && o.metadata.name.startsWith('sub-'))).toHaveLength(0);
  });
});
