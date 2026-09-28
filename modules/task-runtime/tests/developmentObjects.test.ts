import { expect, test } from 'bun:test';
import type { DevelopmentSourceBinding, TaskId, UserId } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { Resources } from '@crewstation/k8s';
import { runtimeImageFixture } from './runtimeImageFixture';

const available = await testDatabaseAvailable();
test.skipIf(!available)('开发工作区和 Agent 继承固定对象空间，当前父子准入共同决定来源权限', async () => {
  const calls: unknown[] = [], planId = newResourceId();
  const f = await runtimeImageFixture(undefined, 'ledger', { objectEnv: async (...args) => { calls.push(args); return { CS_OBJECTS_URL: 'http://api/objects', CS_OBJECT_SPACE_ID: 'dev-space' }; } });
  try {
    const parent = await f.runtime.api.createEnvironment({ serviceId: f.serviceId, kind: 'dev-session', developmentObjectPlanId: planId });
    const binding: DevelopmentSourceBinding = { podUid: 'parent-uid', podName: parent.podName, taskId: parent.id, ip: '10.1.1.1', ready: true };
    expect(await f.runtime.api.resolveDevelopmentObjectSource(binding)).toBeUndefined();
    const { values, pod } = await f.bind(parent.id); binding.podUid = pod.metadata.uid!;
    expect(values.CS_OBJECT_SPACE_ID).toBe('dev-space');
    expect(calls).toEqual([[f.serviceId, 'development', planId]]);
    expect((await f.load(parent.id)).render?.developmentObjectPlanId).toBe(planId);
    const expected = { projectId: f.projectId, serviceId: f.serviceId, planId };
    expect(await f.runtime.api.resolveDevelopmentObjectSource(binding)).toEqual(expected);
    expect(await f.runtime.api.resolveDevelopmentObjectSource({ ...binding, ready: false })).toBeUndefined();
    expect(await f.runtime.api.resolveDevelopmentObjectSource({ ...binding, podName: 'previous-pod' })).toBeUndefined();
    expect(await f.runtime.api.resolveDevelopmentObjectSource({ ...binding, podUid: 'previous-uid' })).toBeUndefined();
    const child = await f.runtime.api.createNativeExecution({ id: newResourceId() as TaskId, parentTaskId: parent.id, purpose: 'agent', createdBy: newResourceId() as UserId, agentId: newResourceId(), runnerId: newResourceId(), fingerprint: 'a'.repeat(64) });
    const childBinding = { ...binding, taskId: child.id, podName: child.podName };
    expect((await f.load(child.id)).render?.developmentObjectPlanId).toBe(planId);
    expect(await f.runtime.api.resolveDevelopmentObjectSource(childBinding)).toBeUndefined();
    const childReady = await f.bind(child.id), childValues = childReady.values; childBinding.podUid = childReady.pod.metadata.uid!;
    expect(childValues.CS_OBJECT_SPACE_ID).toBe('dev-space');
    expect(await f.runtime.api.resolveDevelopmentObjectSource(childBinding)).toEqual(expected);
    const current = await f.load(parent.id);
    await f.uow.run(({ environments }) => environments.update({ ...current, podName: 'rebuilt-workspace' }));
    expect(await f.runtime.api.resolveDevelopmentObjectSource(childBinding)).toBeUndefined();
    expect(await f.runtime.api.resolveDevelopmentObjectSource(binding)).toBeUndefined();
    await f.uow.run(({ environments }) => environments.update({ ...current, connected: false }));
    expect(await f.runtime.api.resolveDevelopmentObjectSource(childBinding)).toBeUndefined();
    expect(await f.runtime.api.resolveDevelopmentObjectSource(binding)).toBeUndefined();
    expect(JSON.stringify(await f.resources.api.list({}))).not.toContain('CS_OBJECT_SPACE_ID');
  } finally { await f.close(); }
});

test.skipIf(!available)('业务任务不能选择开发对象空间，旧创建方式和未配置能力明确拒绝', async () => {
  const f = await runtimeImageFixture(), legacy = await runtimeImageFixture(undefined, 'owner', { objectEnv: async () => ({}) });
  try {
    for (const [runtime, serviceId, kind, planId] of [
      [f.runtime, f.serviceId, 'business', newResourceId()], [f.runtime, f.serviceId, 'dev-session', newResourceId()],
      [legacy.runtime, legacy.serviceId, 'dev-session', newResourceId()], [legacy.runtime, legacy.serviceId, 'dev-session', 'invalid'],
    ] as const) await expect(runtime.api.createEnvironment({ serviceId, kind, developmentObjectPlanId: planId })).rejects.toMatchObject({ kind: 'validation' });
    const ordinary = await f.runtime.api.createEnvironment({ serviceId: f.serviceId, kind: 'business' });
    expect((await f.runtime.api.runnerValues(ordinary.id)).CS_OBJECT_SPACE_ID).toBeUndefined();
    expect(await f.runtime.api.resolveDevelopmentObjectSource({ taskId: ordinary.id, podName: ordinary.podName, podUid: 'business-pod', ip: '10.1.1.2', ready: true })).toBeUndefined();
  } finally { await f.close(); await legacy.close(); }
});

test.skipIf(!available)('保卷重建保持开发对象档位并使旧实例来源失效', async () => {
  const planId = newResourceId(), f = await runtimeImageFixture(undefined, 'ledger', { objectEnv: async () => ({ CS_OBJECT_SPACE_ID: 'same-space' }) });
  try {
    const task = await f.runtime.api.createEnvironment({ serviceId: f.serviceId, kind: 'dev-session', developmentObjectPlanId: planId });
    const { pod } = await f.bind(task.id), before = await f.load(task.id);
    await f.k8s.mergePatch(Resources.PersistentVolumeClaim!, before.pvcName, before.namespace, { status: { phase: 'Bound', capacity: { storage: '2Gi' } } });
    await f.k8s.mergePatch(Resources.Pod!, task.podName, before.namespace, { status: { phase: 'Failed' } });
    await f.runtime.api.markFailed(task.id, 'test rebuilding original volume');
    const check = await f.runtime.api.inspectRebuild(f.projectId), profile = check.profiles[0]!;
    await f.runtime.api.requestRebuild(f.projectId, { requestId: newResourceId(), expectedTaskId: task.id, expectedUpdatedAt: check.updatedAt, expectedPodUid: check.podUid, expectedVolumeUid: check.volume.uid, profile: { id: profile.id, name: profile.name, cpu: profile.cpu, memory: profile.memory, storage: profile.storage } });
    const after = await f.load(task.id);
    expect(after.render?.developmentObjectPlanId).toBe(planId); expect(after.pvcName).toBe(before.pvcName); expect(after.podName).not.toBe(before.podName);
    expect(await f.runtime.api.resolveDevelopmentObjectSource({ taskId: task.id, podUid: pod.metadata.uid!, podName: task.podName, ip: '10.1.1.1', ready: true })).toBeUndefined();
  } finally { await f.close(); }
});
