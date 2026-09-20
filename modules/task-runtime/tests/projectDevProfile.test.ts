import { afterEach, describe, expect, test } from 'bun:test';
import { Resources } from '@crewstation/k8s';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { rebuildFixture } from './rebuildFixture';

const available = await testDatabaseAvailable();
let f: Awaited<ReturnType<typeof rebuildFixture>> | undefined;
afterEach(async () => { await f?.close(); f = undefined; });

describe.skipIf(!available)('项目开发容器套餐', () => {
  test('新开发容器使用项目分配的 CPU、内存和存储；业务任务仍使用自己的套餐', async () => {
    f = await rebuildFixture({ assignedProfile: 'coding-large' });
    expect(f.env.profile).toBe('coding-large');
    const pod = await f.k8s.get(Resources.Pod!, f.env.podName, f.env.namespace);
    expect(pod?.spec).toMatchObject({ containers: [{ resources: { limits: { cpu: '2', memory: '4Gi' } } }] });
    const volume = await f.k8s.get(Resources.PersistentVolumeClaim!, f.env.pvcName, f.env.namespace);
    expect(volume?.spec).toMatchObject({ resources: { requests: { storage: '20Gi' } } });
    const task = await f.runtime.api.createEnvironment({ serviceId: f.serviceId, kind: 'business', profile: 'coding-medium' });
    expect(task.profile).toBe('coding-medium');
  });

  test('恢复只提供分配的套餐；检查后授权变化或手填更大套餐均拒绝，重新检查后使用新套餐', async () => {
    f = await rebuildFixture();
    const stale = await f.request(); // 检查时项目尚未被单独分配。
    f.state.assignedProfile = 'coding-medium';
    await expect(f.runtime.api.requestRebuild(f.projectId, stale)).rejects.toMatchObject({ kind: 'precondition', message: expect.stringContaining('项目开发套餐已调整') });
    expect((await f.runtime.api.inspectRebuild(f.projectId)).profiles.map((p) => p.name)).toEqual(['coding-medium']);
    const valid = await f.request();
    expect((await f.runtime.api.requestRebuild(f.projectId, valid)).state).toBe('queued');
    await f.run();
    expect(await f.runtime.api.getEnvironment(f.env.id)).toMatchObject({ profile: 'coding-medium' });
  });

  test('移除分配的套餐后明确拒绝新建，不悄悄回落到平台默认', async () => {
    f = await rebuildFixture();
    await f.runtime.api.releaseEnvironment(f.env.id, 'user');
    f.state.assignedProfile = 'missing';
    await expect(f.runtime.api.createEnvironment({ serviceId: f.serviceId, kind: 'dev-session', profile: 'coding-medium' })).rejects.toMatchObject({ kind: 'validation', message: '任务套餐 missing 不存在' });
  });
});
