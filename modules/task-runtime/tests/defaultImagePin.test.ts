import { afterEach, describe, expect, test } from 'bun:test';
import type { TaskId } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { Resources } from '@crewstation/k8s';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { imageSnapshot, runtimeImageFixture } from './runtimeImageFixture';

const available = await testDatabaseAvailable(), cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });
describe.skipIf(!available)('平台默认任务镜像固定', () => {
  test('旧 owner 建容器路径不新增仓库依赖，显式运行镜像仍要求台账准入', async () => {
    const f = await runtimeImageFixture(async () => { throw new Error('legacy must not resolve registry'); }, 'owner'); cleanups.push(f.close);
    const task = await f.runtime.api.createEnvironment({ serviceId: f.serviceId, kind: 'business' });
    const env = await f.load(task.id), pod = await f.k8s.get(Resources.Pod!, env.podName, env.namespace);
    expect(pod?.spec).toMatchObject({ containers: [{ image: 'platform:fallback' }] });
    await expect(f.runtime.api.createEnvironment({ serviceId: f.serviceId, kind: 'business', runtimeImage: imageSnapshot() })).rejects.toThrow('资源台账');
  });
  test('重复准入与工作区故障重建保留原摘要，新任务才解析当前默认', async () => {
    let calls = 0, tag = `registry/platform@sha256:${'a'.repeat(64)}`;
    const f = await runtimeImageFixture(async () => { calls++; return tag; }); cleanups.push(f.close);
    const admission = { id: newResourceId() as TaskId, fingerprint: 'a'.repeat(64) };
    const input = { serviceId: f.serviceId, kind: 'business' as const, admission };
    const task = await f.runtime.api.createEnvironment(input), original = tag;
    expect((await f.load(task.id)).render?.image).toBe(original);
    expect(task.image).toBe(original);
    tag = `registry/platform@sha256:${'b'.repeat(64)}`;
    await f.runtime.api.createEnvironment(input); expect(calls).toBe(1);
    const next = await f.runtime.api.createEnvironment({ serviceId: f.serviceId, kind: 'business' });
    expect((await f.load(next.id)).render?.image).toBe(tag);
    const workspace = await f.runtime.api.createEnvironment({ serviceId: f.serviceId, kind: 'dev-session' }); await f.bind(workspace.id);
    const bound = await f.load(workspace.id);
    await f.k8s.mergePatch(Resources.PersistentVolumeClaim!, bound.pvcName, bound.namespace, { status: { phase: 'Bound', capacity: { storage: '2Gi' } } });
    await f.k8s.mergePatch(Resources.Pod!, bound.podName, bound.namespace, { status: { phase: 'Failed' } });
    await f.runtime.api.markFailed(workspace.id, 'test failure');
    const inspection = await f.runtime.api.inspectRebuild(f.projectId), profile = inspection.profiles[0]!;
    tag = `registry/platform@sha256:${'c'.repeat(64)}`;
    const before = calls;
    await f.runtime.api.requestRebuild(f.projectId, { requestId: newResourceId(), expectedTaskId: workspace.id, expectedUpdatedAt: inspection.updatedAt, expectedPodUid: inspection.podUid, expectedVolumeUid: inspection.volume.uid, profile: { id: profile.id, name: profile.name, cpu: profile.cpu, memory: profile.memory, storage: profile.storage } });
    expect(calls).toBe(before);
    expect((await f.load(workspace.id)).render).toMatchObject({ image: `registry/platform@sha256:${'b'.repeat(64)}`, start: 2 });
  });
  test('默认摘要读取失败不占额，显式已验证镜像不依赖默认仓库读取', async () => {
    const f = await runtimeImageFixture(async () => { throw new Error('registry unavailable'); }); cleanups.push(f.close);
    await expect(f.runtime.api.createEnvironment({ serviceId: f.serviceId, kind: 'business' })).rejects.toThrow('registry unavailable');
    expect(await f.resources.api.occupancy(f.projectId)).toBe(0);
    const image = imageSnapshot(), task = await f.runtime.api.createEnvironment({ serviceId: f.serviceId, kind: 'business', runtimeImage: image });
    expect((await f.load(task.id)).render?.image).toBe(image.image);
  });
});
