import { afterEach, describe, expect, test } from 'bun:test';
import type { TaskId, UserId } from '@crewstation/contracts';
import { Resources } from '@crewstation/k8s';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { rebuildFixture } from './rebuildFixture';
const available = await testDatabaseAvailable();
let f: Awaited<ReturnType<typeof rebuildFixture>> | undefined;
afterEach(async () => { await f?.close(); f = undefined; });
describe.skipIf(!available)('administrator workspace restart', () => {
  test('running workspace keeps task/PVC identity, reaps children before its Pod, retains quota once and binds the new UID', async () => {
    f = await rebuildFixture({ running: true }); f.state.quota = 3;
    const { runtime, env, k8s, projectId } = f, volume = structuredClone(await k8s.get(Resources.PersistentVolumeClaim!, env.pvcName, env.namespace));
    const child = await runtime.api.createNativeExecution({ id: '01a0bf5d-8f4b-780e-826f-c732652342f0' as TaskId, parentTaskId: env.id, createdBy: '01a0bf5d-8f4b-7e44-886a-b79b12465703' as UserId, agentId: 'agent', terminalId: 'pty', runnerId: crypto.randomUUID(), fingerprint: 'f'.repeat(64), profile: '01a0bf5d-8f4b-7001-8458-107366e7de39' });
    await f.runNative(); expect(await runtime.api.runningTaskCount(projectId)).toBe(2);
    await expect(runtime.api.inspectRebuild(projectId)).rejects.toThrow();
    const inspected = await runtime.api.inspectRebuild(projectId, true), profile = inspected.profiles.find((p) => p.id === inspected.currentProfile)!;
    const input = { requestId: crypto.randomUUID(), expectedTaskId: env.id, expectedUpdatedAt: inspected.updatedAt, expectedPodUid: inspected.podUid, expectedVolumeUid: inspected.volume.uid, reason: 'administrator-restart' as const, profile: { id: profile.id, name: profile.name, cpu: profile.cpu, memory: profile.memory, storage: profile.storage } };
    await runtime.api.requestRebuild(projectId, input); await f.run();
    expect(await k8s.get(Resources.Pod!, env.podName, env.namespace)).toBeDefined(); expect(await runtime.api.runningTaskCount(projectId)).toBe(2);
    await f.nextNativeAttempt(); await f.nextAttempt();
    expect((await runtime.api.getEnvironment(child.id))?.native?.state).toBe('finished');
    const current = (await f.uow.read.environments.getById(env.id))!;
    expect(current.id).toBe(env.id); expect(current.podUid).not.toBe(env.podUid); expect(current.podUid).toBe((await k8s.get(Resources.Pod!, current.podName, current.namespace))?.metadata.uid);
    expect(await k8s.get(Resources.PersistentVolumeClaim!, env.pvcName, env.namespace)).toEqual(volume); expect(await runtime.api.runningTaskCount(projectId)).toBe(1); expect(f.state.checkoutCalls).toBe(1);
    const secret = (await k8s.get(Resources.Secret!, `${current.podName}-runner`, current.namespace))!;
    await runtime.api.onRunnerConnected(env.id, (secret.stringData as Record<string, string>).CS_RUNNER_TOKEN!);
    expect(await runtime.api.getRebuild(env.id)).toMatchObject({ state: 'ready' }); expect((await runtime.api.listClusterTasks()).find((t) => t.taskId === env.id)?.podUid).toBe(current.podUid);
    expect((await runtime.api.requestRebuild(projectId, input)).requestId).toBe(input.requestId);
  });
  test('normal release is UID conditional and cannot remove a replacement with the same name', async () => {
    f = await rebuildFixture({ running: true }); const env = (await f.uow.read.environments.getById(f.env.id))!;
    await f.k8s.mergePatch(Resources.Pod!, env.podName, env.namespace, { metadata: { uid: 'replacement' } });
    await expect(f.runtime.api.releaseEnvironment(env.id, 'user')).rejects.toMatchObject({ kind: 'conflict' });
    expect((await f.k8s.get(Resources.Pod!, env.podName, env.namespace))?.metadata.uid).toBe('replacement');
  });
});
