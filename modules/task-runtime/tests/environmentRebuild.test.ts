import { afterEach, describe, expect, test } from 'bun:test';
import { Resources } from '@crewstation/k8s';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { rebuildFixture } from './rebuildFixture';

const available = await testDatabaseAvailable();
let f: Awaited<ReturnType<typeof rebuildFixture>> | undefined;
afterEach(async () => { await f?.close(); f = undefined; });

describe.skipIf(!available)('原任务原卷重建', () => {
  test('受理与完成分离，保留卷和布局标识、不检出、不启动 Agent，旧 Runner 回调无效', async () => {
    f = await rebuildFixture(); const { runtime, k8s, env, projectId } = f;
    const volume = structuredClone(await k8s.get(Resources.PersistentVolumeClaim!, env.pvcName, env.namespace));
    const input = await f.request();
    expect((await runtime.api.requestRebuild(projectId, input)).state).toBe('queued');
    expect(await runtime.api.runningTaskCount(projectId)).toBe(1);
    expect(await runtime.api.verifyRunnerToken(env.id, f.token)).toMatchObject({ ok: false });
    expect(await runtime.api.onRunnerConnected(env.id, f.token)).toBe(false);
    await runtime.api.reconcile(); // Pod 尚未创建不能被 Missing 对账误报失败。
    expect((await runtime.api.getEnvironment(env.id))?.state).toBe('creating');
    await expect(runtime.api.releaseEnvironment(env.id, 'user')).rejects.toThrow('正在重建');
    await f.run();
    const record = (await f.uow.read.rebuilds.get(input.requestId))!, current = (await f.uow.read.environments.getById(env.id))!;
    expect(record.state).toBe('starting'); expect(current.podName).not.toBe(env.podName);
    expect(current.id).toBe(env.id); expect(current.pvcName).toBe(env.pvcName); expect(current.branch).toBe(env.branch);
    expect(await k8s.get(Resources.PersistentVolumeClaim!, env.pvcName, env.namespace)).toEqual(volume);
    expect(await k8s.get(Resources.Pod!, env.podName, env.namespace)).toBeUndefined();
    const pod = (await k8s.get(Resources.Pod!, current.podName, env.namespace))!, spec = pod.spec as Record<string, unknown>;
    expect(spec.initContainers).toBeUndefined(); expect(f.state.checkoutCalls).toBe(1);
    expect(JSON.stringify(pod)).not.toContain(f.token);
    expect(spec.containers).toMatchObject([{ env: [], envFrom: [{ secretRef: { name: record.secretName } }], resources: { limits: { cpu: '2', memory: '4Gi' } } }]);
    const secret = (await k8s.get(Resources.Secret!, record.secretName, env.namespace))!;
    const newToken = (secret.stringData as Record<string, string>).CS_RUNNER_TOKEN!;
    expect(newToken).not.toBe(f.token); expect(JSON.stringify(record)).not.toContain(newToken);
    expect(await runtime.api.onRunnerConnected(env.id, newToken)).toBe(true);
    await runtime.api.onRunnerDisconnected(env.id, f.token);
    expect(await runtime.api.getEnvironment(env.id)).toMatchObject({ state: 'running', connected: true });
    expect(await runtime.api.getRebuild(env.id)).toMatchObject({ state: 'ready' });
    expect(k8s.applied.filter((o) => o.kind === 'IngressRoute').every((o) => o.metadata.name === env.podName)).toBe(true);
    await runtime.api.releaseEnvironment(env.id, 'user');
    expect(await runtime.api.runningTaskCount(projectId)).toBe(0);
    expect(await k8s.get(Resources.PersistentVolumeClaim!, env.pvcName, env.namespace)).toBeUndefined();
    expect(await k8s.get(Resources.IngressRoute!, env.podName, env.namespace)).toBeUndefined();
    expect(await k8s.get(Resources.Secret!, record.secretName, env.namespace)).toBeUndefined();
  });

  test('相同请求并发只占一次配额；不同请求、旧修订和另建会话不能跨越恢复', async () => {
    f = await rebuildFixture(); const input = await f.request();
    const [a, b] = await Promise.all([f.runtime.api.requestRebuild(f.projectId, input), f.runtime.api.requestRebuild(f.projectId, { ...input })]);
    expect(a).toEqual(b); expect(await f.runtime.api.runningTaskCount(f.projectId)).toBe(1);
    await expect(f.runtime.api.requestRebuild(f.projectId, { ...input, requestId: crypto.randomUUID() })).rejects.toMatchObject({ kind: 'precondition' });
    await expect(f.runtime.api.requestRebuild(f.projectId, { ...input, profile: { ...input.profile, cpu: '3' } })).rejects.toMatchObject({ kind: 'conflict' });
    await expect(f.runtime.api.createEnvironment({ serviceId: f.serviceId, kind: 'dev-session' })).rejects.toMatchObject({ kind: 'conflict' });
    const jobs = await f.tdb.db.execute(sql`SELECT count(*)::int AS count FROM platform_infra.jobs`);
    expect([...jobs].map((row) => row.count)).toEqual([1]);
  });

  test('旧检查、套餐变更、配额不足以及失败会话被新会话替换均无集群副作用', async () => {
    f = await rebuildFixture(); const input = await f.request(); const before = structuredClone([...f.k8s.objects]);
    await expect(f.runtime.api.requestRebuild(f.projectId, { ...input, expectedUpdatedAt: '2026-01-01T00:00:00.000Z' })).rejects.toMatchObject({ kind: 'conflict' });
    f.state.profiles[1]!.cpu = '3';
    await expect(f.runtime.api.requestRebuild(f.projectId, input)).rejects.toMatchObject({ kind: 'conflict' }); f.state.profiles[1]!.cpu = '2';
    f.state.quota = 0; await expect(f.runtime.api.requestRebuild(f.projectId, input)).rejects.toMatchObject({ kind: 'quota_exceeded' });
    expect([...f.k8s.objects]).toEqual(before); expect(await f.runtime.api.runningTaskCount(f.projectId)).toBe(0);
    f.state.quota = 2; await f.runtime.api.createEnvironment({ serviceId: f.serviceId, kind: 'dev-session' });
    await expect(f.runtime.api.requestRebuild(f.projectId, input)).rejects.toMatchObject({ kind: 'precondition' });
  });

  test('提交检查捕捉实际 Pod 与工作卷变化，读取错误不能解释为可恢复', async () => {
    f = await rebuildFixture(); const input = await f.request(), { k8s, env } = f;
    await k8s.mergePatch(Resources.Pod!, env.podName, env.namespace, { status: { phase: 'Running' } });
    await expect(f.runtime.api.requestRebuild(f.projectId, input)).rejects.toThrow('尚未结束');
    await k8s.mergePatch(Resources.Pod!, env.podName, env.namespace, { status: { phase: 'Failed' } });
    await k8s.mergePatch(Resources.PersistentVolumeClaim!, env.pvcName, env.namespace, { metadata: { uid: 'another-volume' } });
    await expect(f.runtime.api.requestRebuild(f.projectId, input)).rejects.toThrow('实例已变化');
    await k8s.mergePatch(Resources.PersistentVolumeClaim!, env.pvcName, env.namespace, { status: { phase: 'Pending' } });
    await expect(f.runtime.api.inspectRebuild(f.projectId)).rejects.toThrow('尚未就绪');
    await k8s.delete(Resources.PersistentVolumeClaim!, env.pvcName, env.namespace);
    await expect(f.runtime.api.inspectRebuild(f.projectId)).rejects.toThrow('原工作卷不存在');
    expect(await f.runtime.api.runningTaskCount(f.projectId)).toBe(0);
  });
});
