import { afterEach, describe, expect, test } from 'bun:test';
import { Resources } from '@crewstation/k8s';
import { precondition } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { rebuildFixture } from './rebuildFixture';

const available = await testDatabaseAvailable();
let f: Awaited<ReturnType<typeof rebuildFixture>> | undefined;
afterEach(async () => { await f?.close(); f = undefined; });
const rejection = { code: 'protocol_mismatch' as const, runnerProtocol: 1, message: 'Runner 协议版本 1，平台要求 2' };

describe.skipIf(!available)('RFC-008 旧协议开发环境保卷恢复', () => {
  test('仍运行的旧协议环境可检查和恢复，满额时沿用已占额度，保留原卷且不重新检出', async () => {
    f = await rebuildFixture({ running: true }); f.state.quota = 1;
    await f.runtime.api.onRunnerRejected(f.env.id, f.token, rejection);
    expect(await f.runtime.api.getEnvironment(f.env.id)).toMatchObject({ connected: false, connectionIssue: { ...rejection, requiredProtocol: 2 } });
    // 旧版本只写拒绝原因，可能把历史 connected=true 留下来；真实握手已被拒绝。
    const legacy = (await f.uow.read.environments.getById(f.env.id))!;
    await f.uow.run((scope) => scope.environments.update({ ...legacy, connected: true }));
    expect((await f.runtime.api.getEnvironment(f.env.id))?.connected).toBe(false);
    // 实机旧 Pod 仍 Running，之前只有 failed 才能恢复，使开发页永久卡在不可创建 CLI。
    const check = await f.runtime.api.inspectRebuild(f.projectId);
    expect(check).toMatchObject({ reason: 'protocol_mismatch', taskId: f.env.id });
    const input = { ...await f.request(), reason: 'protocol_mismatch' as const };
    const volume = structuredClone(await f.k8s.get(Resources.PersistentVolumeClaim!, f.env.pvcName, f.env.namespace));
    const first = await f.runtime.api.requestRebuild(f.projectId, input);
    expect(await f.runtime.api.requestRebuild(f.projectId, input)).toEqual(first);
    await expect(f.runtime.api.inspectRebuild(f.projectId)).rejects.toMatchObject({ kind: 'precondition' });
    expect(await f.runtime.api.runningTaskCount(f.projectId)).toBe(1);
    expect(await f.runtime.api.onRunnerConnected(f.env.id, f.token)).toBe(false);
    await f.run();
    const record = (await f.uow.read.rebuilds.get(input.requestId))!;
    expect(record.state).toBe('starting');
    expect(await f.k8s.get(Resources.Pod!, f.env.podName, f.env.namespace)).toBeUndefined();
    expect(await f.k8s.get(Resources.PersistentVolumeClaim!, f.env.pvcName, f.env.namespace)).toEqual(volume);
    expect(f.state.checkoutCalls).toBe(1);
    const secret = (await f.k8s.get(Resources.Secret!, record.secretName, record.namespace))!;
    expect(await f.runtime.api.onRunnerConnected(f.env.id, (secret.stringData as Record<string, string>).CS_RUNNER_TOKEN!)).toBe(true);
    expect(await f.runtime.api.getEnvironment(f.env.id)).toMatchObject({ id: f.env.id, state: 'running', connected: true });
    expect((await f.uow.read.environments.getById(f.env.id))?.runnerRejection).toBeUndefined();
    expect(await f.runtime.api.getRebuild(f.env.id)).toMatchObject({ state: 'ready' });
    expect(await f.runtime.api.runningTaskCount(f.projectId)).toBe(1);
  });

  test('健康或仅断线环境不可重建；检查后重新连接、故障原因和 Pod 变化会拒绝旧确认', async () => {
    f = await rebuildFixture({ running: true });
    await expect(f.runtime.api.inspectRebuild(f.projectId)).rejects.toMatchObject({ kind: 'precondition' });
    await f.runtime.api.onRunnerDisconnected(f.env.id, f.token);
    await expect(f.runtime.api.inspectRebuild(f.projectId)).rejects.toMatchObject({ kind: 'precondition' });
    await f.runtime.api.onRunnerRejected(f.env.id, f.token, rejection);
    const input = { ...await f.request(), reason: 'protocol_mismatch' as const };
    await expect(f.runtime.api.requestRebuild(f.projectId, { ...input, reason: 'failed' })).rejects.toMatchObject({ kind: 'conflict' });
    await expect(f.runtime.api.requestRebuild(f.projectId, { ...input, expectedPodUid: 'different' })).rejects.toMatchObject({ kind: 'conflict' });
    expect(await f.runtime.api.onRunnerConnected(f.env.id, f.token)).toBe(true);
    await expect(f.runtime.api.requestRebuild(f.projectId, input)).rejects.toMatchObject({ kind: 'precondition' });
    expect(await f.runtime.api.runningTaskCount(f.projectId)).toBe(1);
    expect(await f.k8s.get(Resources.Pod!, f.env.podName, f.env.namespace)).toBeDefined();
  });

  test('检查后的页面活动只更新活跃时间，不使恢复确认过期', async () => {
    f = await rebuildFixture({ running: true });
    await f.runtime.api.onRunnerRejected(f.env.id, f.token, rejection);
    const input = { ...await f.request(), reason: 'protocol_mismatch' as const };
    const before = (await f.uow.read.environments.getById(f.env.id))!;
    f.advance(60_000);
    await f.runtime.api.touch(f.env.id);
    const after = (await f.uow.read.environments.getById(f.env.id))!;
    expect(after.lastActivityAt.getTime()).toBeGreaterThan(before.lastActivityAt.getTime());
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(await f.runtime.api.requestRebuild(f.projectId, input)).toMatchObject({ state: 'queued' });
  });

  test('替换失败保留卷且只释放一次原占额，回放原请求不会重复恢复', async () => {
    f = await rebuildFixture({ running: true });
    await f.runtime.api.onRunnerRejected(f.env.id, f.token, rejection);
    const input = { ...await f.request(), reason: 'protocol_mismatch' as const };
    await f.runtime.api.requestRebuild(f.projectId, input);
    const create = f.k8s.create;
    f.k8s.create = async (object) => { if (object.kind === 'Pod') throw precondition('新容器无法创建'); return create(object); };
    await f.run(); await f.nextAttempt();
    expect(await f.runtime.api.getRebuild(f.env.id)).toMatchObject({ state: 'failed' });
    expect(await f.runtime.api.runningTaskCount(f.projectId)).toBe(0);
    expect(await f.k8s.get(Resources.PersistentVolumeClaim!, f.env.pvcName, f.env.namespace)).toBeDefined();
    expect((await f.runtime.api.requestRebuild(f.projectId, input)).state).toBe('failed');
    expect(await f.runtime.api.runningTaskCount(f.projectId)).toBe(0);
  });
});
