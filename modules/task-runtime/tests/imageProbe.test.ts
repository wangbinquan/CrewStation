import { afterEach, describe, expect, test } from 'bun:test';
import type { TaskId } from '@crewstation/contracts';
import { Resources } from '@crewstation/k8s';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { imageSnapshot, runtimeImageFixture } from './runtimeImageFixture';

const available = await testDatabaseAvailable(), cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
async function fixture() { const f = await runtimeImageFixture(); cleanup.push(f.close); return f; }

describe.skipIf(!available)('隔离镜像任务验证', () => {
  test('实际镜像身份、初始化、worker exec 通过后才给 passed；物理清理前保留容量', async () => {
    const f = await fixture(), image = imageSnapshot(), id = image.validationId as TaskId;
    const result = f.runtime.api.runRuntimeImageProbe({ validationId: id, projectId: f.projectId, snapshot: image, deadline: new Date(Date.now() + 30000).toISOString() }, async () => true);
    for (let i = 0; i < 100 && !await f.uow.read.environments.getById(id); i++) await Bun.sleep(10);
    const env = await f.load(id); expect(env.kind).toBe('profile-test');
    expect(env.render?.workVolume).toBe('emptyDir');
    // 项目镜像验证不能随平台档位测试一起失去真实项目的存在／删除准入保护。
    expect((await f.resources.api.get(id))?.projectId).toBe(f.projectId);
    const { values } = await f.bind(id); expect(values.GREETING).toBeUndefined();
    await f.k8s.mergePatch(Resources.Pod!, env.podName, env.namespace, { status: { containerStatuses: [{ name: 'taskrunner', imageID: image.image }] } });
    await f.status(id, 'succeeded'); await f.runtime.api.observeStartup();
    expect(await result).toMatchObject({ state: 'passed', observedImageId: image.image, checks: [{ key: 'worker-uid', passed: true }] });
    expect(await f.runtime.api.stopRuntimeImageProbe(id)).toBe(false);
    expect((await f.load(id)).render?.runtimeValidation?.quotaHeld).toBe(true);
    expect((await f.resources.api.get(id))?.desired).toBe('absent');
    await f.k8s.delete(Resources.Pod!, env.podName, env.namespace);
    expect(await f.runtime.api.stopRuntimeImageProbe(id)).toBe(true);
    expect(await f.load(id)).toMatchObject({ state: 'released', render: { runtimeValidation: { quotaHeld: false } } });
    expect(await f.runtime.api.stopRuntimeImageProbe(id)).toBe(true);
  });

  test('停止先于创建也留下墓碑，迟到工作器不能复活原验证身份', async () => {
    const f = await fixture(), image = imageSnapshot(), id = image.validationId as TaskId;
    expect(await f.runtime.api.stopRuntimeImageProbe(id)).toBe(true);
    await expect(f.runtime.api.runRuntimeImageProbe({ validationId: id, projectId: f.projectId, snapshot: image, deadline: new Date(Date.now() + 30000).toISOString() }, async () => true)).rejects.toThrow('不能重建');
    expect(await f.resources.api.get(id)).toBeUndefined();
    const occupied = await f.uow.read.admissions.running((await f.load(id)).projectId);
    expect(occupied).toBe(0);
    const normal = await f.runtime.api.createEnvironment({ serviceId: f.serviceId, kind: 'business' });
    await expect(f.runtime.api.stopRuntimeImageProbe(normal.id)).rejects.toThrow('身份冲突');
    expect((await f.runtime.api.getEnvironment(normal.id))?.state).toBe('creating');
  });
});
