import { afterEach, describe, expect, test } from 'bun:test';
import type { TaskId } from '@crewstation/contracts';
import { RuntimeInitializationMaterialSchema } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { Resources } from '@crewstation/k8s';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { imageSnapshot, runtimeImageFixture } from './runtimeImageFixture';

const available = await testDatabaseAvailable();
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const fixture = async () => { const f = await runtimeImageFixture(); cleanups.push(f.close); return f; };

describe.skipIf(!available)('运行镜像任务接线', () => {
  test('显式镜像 Pod 已创建但 Runner 从未连接，五分钟后保卷回收，不无限占额', async () => {
    const f = await fixture(), task = await f.runtime.api.createEnvironment({ serviceId: f.serviceId, kind: 'business', volumeMode: 'persistent', runtimeImage: imageSnapshot() });
    await f.bind(task.id, false); f.advance(299_999); await f.runtime.api.observeStartup();
    expect((await f.load(task.id)).state).toBe('creating');
    f.advance(2); await f.runtime.api.observeStartup();
    const stopped = await f.load(task.id);
    expect(stopped.state).toBe('failed'); expect(stopped.message).toContain('Runner 连接超过期限');
    expect(await f.k8s.get(Resources.Pod!, stopped.podName, stopped.namespace)).toBeUndefined();
    expect(await f.k8s.get(Resources.PersistentVolumeClaim!, stopped.pvcName, stopped.namespace)).toBeDefined();
    expect(await f.resources.api.occupancy(f.projectId)).toBe(0);
  });
  test('不可变镜像与初始化材料进入期望，连接不等于 ready，初始化回执通过后才运行', async () => {
    const f = await fixture(), image = imageSnapshot();
    const task = await f.runtime.api.createEnvironment({ serviceId: f.serviceId, kind: 'business', runtimeImage: image });
    const record = await f.resources.api.get(task.id);
    expect(record?.spec['pod']).toMatchObject({ image: image.image, runtimeInitialization: true });
    expect(JSON.stringify(record)).not.toContain('CS_RUNTIME_IMAGE_INITIALIZATION');
    const { values, pod } = await f.bind(task.id);
    expect(RuntimeInitializationMaterialSchema.parse(JSON.parse(values.CS_RUNTIME_IMAGE_INITIALIZATION!))).toMatchObject({ environmentId: task.id, startGeneration: 1, versionId: image.versionId, secrets: {} });
    expect((pod.spec as { volumes: unknown[] }).volumes).toContainEqual({ name: 'runtime-initialization', emptyDir: {} });
    expect(await f.runtime.api.getEnvironment(task.id)).toMatchObject({ state: 'creating', connected: true });
    await f.status(task.id, 'running'); await f.runtime.api.observeStartup();
    expect(await f.runtime.api.getEnvironment(task.id)).toMatchObject({ state: 'creating', runtimeInitialization: { state: 'running' } });
    await f.status(task.id, 'succeeded'); await f.runtime.api.observeStartup();
    expect(await f.runtime.api.getEnvironment(task.id)).toMatchObject({ state: 'running', runtimeInitialization: { state: 'succeeded' } });
  });

  test('Agent 独立选择：父镜像不会被继承，自己的快照进入 Pod，同一请求改镜像冲突', async () => {
    const f = await fixture(), parentImage = imageSnapshot();
    const parent = await f.runtime.api.createEnvironment({ serviceId: f.serviceId, kind: 'dev-session', runtimeImage: parentImage });
    await f.bind(parent.id); await f.status(parent.id, 'succeeded'); await f.runtime.api.observeStartup();
    const input = { id: newResourceId() as TaskId, parentTaskId: parent.id, purpose: 'agent' as const, agentId: newResourceId(), runnerId: newResourceId(), fingerprint: 'x' };
    const child = await f.runtime.api.createNativeExecution(input);
    expect((await f.load(child.id)).render).toMatchObject({ image: 'platform:fallback' });
    expect((await f.load(child.id)).render?.runtimeImage).toBeUndefined();
    const ownImage = { ...imageSnapshot(), image: `registry/agent@sha256:${'c'.repeat(64)}`, digest: `sha256:${'c'.repeat(64)}` };
    const own = { ...input, id: newResourceId() as TaskId, runtimeImage: ownImage };
    const selected = await f.runtime.api.createNativeExecution(own);
    expect((await f.load(selected.id)).render).toMatchObject({ image: ownImage.image, runtimeImage: ownImage });
    await expect(f.runtime.api.createNativeExecution({ ...own, runtimeImage: parentImage })).rejects.toMatchObject({ kind: 'conflict' });
    await f.bind(selected.id); expect((await f.load(selected.id)).native?.state).toBe('starting');
    await f.status(selected.id, 'succeeded'); await f.runtime.api.observeStartup();
    expect((await f.load(selected.id)).native?.state).toBe('running');
  });

  test('错误容器的成功回执拒绝；失败先删 Pod 再退额，保留工作卷', async () => {
    const f = await fixture();
    const task = await f.runtime.api.createEnvironment({ serviceId: f.serviceId, kind: 'business', volumeMode: 'persistent', runtimeImage: imageSnapshot() });
    await f.bind(task.id); await f.status(task.id, 'succeeded');
    f.statuses.set(task.id, { ...f.statuses.get(task.id)!, containerIdentity: 'old-pod/1234' });
    expect(await f.resources.api.occupancy(f.projectId)).toBe(1);
    await f.runtime.api.observeStartup();
    const env = await f.load(task.id);
    expect(env).toMatchObject({ state: 'failed', runtimeInitialization: { state: 'unknown' } });
    expect(await f.k8s.get(Resources.Pod!, env.podName, env.namespace)).toBeUndefined();
    expect(await f.k8s.get(Resources.PersistentVolumeClaim!, env.pvcName, env.namespace)).toBeDefined();
    expect(await f.resources.api.occupancy(f.projectId)).toBe(0);
  });

  test('初始化失联超过预算仍能清理；重连不能刷新期限，旧能力不能无限等待', async () => {
    const f = await fixture(), task = await f.runtime.api.createEnvironment({ serviceId: f.serviceId, kind: 'business', volumeMode: 'persistent', runtimeImage: imageSnapshot() });
    const { values } = await f.bind(task.id), firstDeadline = (await f.load(task.id)).render!.runtimeInitializationDeadline;
    f.advance(30_000);
    await f.runtime.api.onRunnerConnected(task.id, values.CS_RUNNER_TOKEN!);
    expect((await f.load(task.id)).render!.runtimeInitializationDeadline).toEqual(firstDeadline);
    await f.runtime.api.onRunnerDisconnected(task.id, values.CS_RUNNER_TOKEN!);
    f.advance(30_001); await f.runtime.api.observeStartup();
    const stopped = await f.load(task.id);
    expect(stopped).toMatchObject({ state: 'failed', runtimeInitialization: { state: 'unknown' } });
    expect(stopped.message).toContain('超过期限');
    expect(await f.k8s.get(Resources.Pod!, stopped.podName, stopped.namespace)).toBeUndefined();
    expect(await f.k8s.get(Resources.PersistentVolumeClaim!, stopped.pvcName, stopped.namespace)).toBeDefined();
    expect(await f.resources.api.occupancy(f.projectId)).toBe(0);
    const old = await f.runtime.api.createEnvironment({ serviceId: f.serviceId, kind: 'business', runtimeImage: imageSnapshot() });
    await f.bind(old.id); f.protocol.supported = false; await f.runtime.api.observeStartup();
    expect(await f.runtime.api.getEnvironment(old.id)).toMatchObject({ state: 'failed' });
    expect((await f.load(old.id)).message).toContain('不支持运行环境初始化协议');
  });

  test('初始化环境变量不能覆盖项目配置，缺失 Secret 适配器拒绝静默丢失凭据', async () => {
    const f = await fixture(), image = imageSnapshot();
    const task = await f.runtime.api.createEnvironment({ serviceId: f.serviceId, kind: 'business', runtimeImage: { ...image, initializer: { ...image.initializer, env: { GREETING: 'override' } } } });
    await expect(f.runtime.api.runnerValues(task.id)).rejects.toThrow('冲突');
    const secret = await f.runtime.api.createEnvironment({ serviceId: f.serviceId, kind: 'business', runtimeImage: { ...image, initializer: { ...image.initializer, secrets: [{ id: 'token', configDefinitionId: newResourceId(), environment: 'development' }] } } });
    await expect(f.runtime.api.runnerValues(secret.id)).rejects.toThrow('尚未配置');
  });
});
