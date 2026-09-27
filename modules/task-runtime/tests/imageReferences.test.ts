import { afterEach, describe, expect, test } from 'bun:test';
import type { TaskId } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { Resources } from '@crewstation/k8s';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { imageSnapshot, runtimeImageFixture } from './runtimeImageFixture';

const available = await testDatabaseAvailable();
let f: Awaited<ReturnType<typeof runtimeImageFixture>>;
afterEach(async () => { await f?.close(); });
async function fixture() {
  f = await runtimeImageFixture();
  const image = imageSnapshot();
  const parent = await f.runtime.api.createEnvironment({ serviceId: f.serviceId, kind: 'dev-session', runtimeImage: image });
  await f.bind(parent.id); await f.status(parent.id, 'succeeded'); await f.runtime.api.observeStartup();
  const query = { projectId: f.projectId, versionId: image.versionId, ownerType: 'session', ownerId: parent.id };
  return { parent, image, query, inspect: f.runtime.api.imageReferenceState };
}
async function markReleased(id: TaskId) {
  await f.uow.run(async (scope) => {
    const env = (await scope.environments.getById(id))!;
    await scope.environments.update({ ...env, state: 'released', connected: false, ...(env.native ? { native: { ...env.native, state: 'finished' } } : {}) });
  });
  await f.resources.api.owner('task-runtime').requestRelease(id, { code: 'test-closed', message: '不可恢复终态夹具' });
}
async function deletePod(id: TaskId) {
  const env = await f.load(id);
  await f.k8s.delete(Resources.Pod!, env.podName, env.namespace);
}

describe.skipIf(!available)('开发镜像引用的不可逆终态证明', () => {
  test('失败可恢复和仍有 Pod 的 released 均保留；物理释放后才回收', async () => {
    const { parent, query, inspect } = await fixture();
    expect(await inspect(query)).toBe('active');
    await f.uow.run(async (scope) => { await scope.environments.update({ ...(await f.load(parent.id)), state: 'failed', connected: false }); });
    expect(await inspect(query)).toBe('active');
    await markReleased(parent.id);
    expect(await inspect(query)).toBe('active');
    await deletePod(parent.id);
    expect(await inspect(query)).toBe('released');
    await expect(f.runtime.api.inspectRebuild(f.projectId)).rejects.toMatchObject({ kind: 'precondition' });
  });
  test('Agent 结束仍保留恢复引用，父会话及自身释放后才给证明', async () => {
    const { parent, inspect } = await fixture(), image = imageSnapshot();
    const child = await f.runtime.api.createNativeExecution({ id: newResourceId() as TaskId, parentTaskId: parent.id, purpose: 'agent', agentId: newResourceId(), runnerId: newResourceId(), fingerprint: 'proof', runtimeImage: image });
    await f.bind(child.id); await f.status(child.id, 'succeeded'); await f.runtime.api.observeStartup();
    const query = { projectId: f.projectId, versionId: image.versionId, ownerType: 'agent', ownerId: child.id };
    await markReleased(child.id); await deletePod(child.id);
    expect(await inspect(query)).toBe('active');
    await markReleased(parent.id);
    expect(await inspect(query)).toBe('active');
    await deletePod(parent.id);
    expect(await inspect(query)).toBe('released');
    expect(await inspect({ ...query, ownerType: 'session' })).toBe('unknown');
  });
  test('缺失和不匹配的所有者不构成回收证明', async () => {
    const { query, inspect } = await fixture();
    for (const delta of [{ ownerId: newResourceId() }, { projectId: newResourceId() }, { versionId: newResourceId() }, { ownerType: 'task' }, { ownerType: 'agent' }]) {
      expect(await inspect({ ...query, ...delta })).toBe('unknown');
    }
  });
});
