import { afterEach, describe, expect, test } from 'bun:test';
import type { TaskId, UserId } from '@crewstation/contracts';
import { Resources } from '@crewstation/k8s';
import { newId, precondition } from '@crewstation/kernel';
import { claimJobs } from '@crewstation/queue';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { NATIVE_EXECUTION_JOB_KIND } from '../ports/repositories';
import { rebuildFixture } from './rebuildFixture';

const available = await testDatabaseAvailable();
let f: Awaited<ReturnType<typeof rebuildFixture>> | undefined;
afterEach(async () => { await f?.close(); f = undefined; });
const input = () => ({ id: newId('tsk') as TaskId, parentTaskId: f!.env.id, createdBy: `usr_${'c'.repeat(32)}` as UserId,
  agentId: newId('agt'), terminalId: newId('pty'), runnerId: crypto.randomUUID(), fingerprint: 'f'.repeat(64) });

describe.skipIf(!available)('独立 CLI 创建与清理的故障接续', () => {
  test('Kubernetes 规范化资源单位后仍接续同一资源快照，实质改变上限则拒绝', async () => {
    f = await rebuildFixture({ running: true });
    Object.assign(f.state.profiles[0]!, { cpu: '0.1', memory: '2048Mi', storage: '1024Mi' });
    const child = await f.runtime.api.createNativeExecution(input()), create = f.k8s.create;
    f.k8s.create = async (object) => {
      if (object.kind === 'Pod') {
        const container = (object.spec as { containers: Array<{ resources: unknown }> }).containers[0]!;
        container.resources = { limits: { memory: '2Gi', 'ephemeral-storage': '1Gi', cpu: '100m' }, requests: { memory: '2Gi', cpu: '100m', 'ephemeral-storage': '1Gi' } };
      }
      return create(object);
    };
    await f.runNative(); expect((await f.runtime.api.getEnvironment(child.id))?.native?.state).toBe('starting');
    expect((await f.runtime.api.getEnvironment(child.id))?.native?.profile).toMatchObject({ cpu: '0.1', memory: '2048Mi' });
    f.state.quota = 3;
    const invalid = await f.runtime.api.createNativeExecution(input()), normalizedCreate = f.k8s.create;
    f.k8s.create = async (object) => {
      const result = await normalizedCreate(object);
      if (object.kind === 'Pod') await f!.k8s.mergePatch(Resources.Pod!, object.metadata.name, f!.env.namespace, { spec: { containers: [{ image: 'task:current', resources: { limits: { memory: '4Gi' } } }] } });
      return object.kind === 'Pod' ? (await f!.k8s.get(Resources.Pod!, object.metadata.name, f!.env.namespace)) as typeof result : result;
    };
    await f.runNative(); await f.nextNativeAttempt();
    expect((await f.runtime.api.getEnvironment(invalid.id))?.state).toBe('failed');
    expect((await f.runtime.api.getEnvironment(invalid.id))?.message).toContain('不一致');
    expect((await f.runtime.api.getEnvironment(child.id))?.native?.state).toBe('starting');
  });
  for (const kind of ['Secret', 'Pod']) test(`${kind} 创建响应丢失后接续同一实例，不重复占额`, async () => {
    f = await rebuildFixture({ running: true }); const request = input(), child = await f.runtime.api.createNativeExecution(request);
    const create = f.k8s.create; let created = 0;
    f.k8s.create = async (object) => { const result = await create(object); if (object.kind === kind && ++created === 1) throw new Error('response lost'); return result; };
    await f.runNative(); expect((await f.runtime.api.getEnvironment(child.id))?.native?.state).toBe('queued');
    const objects = structuredClone([...f.k8s.objects.values()].filter((object) => object.kind === kind));
    await f.nextNativeAttempt();
    expect((await f.runtime.api.getEnvironment(child.id))?.native?.state).toBe('starting');
    expect([...f.k8s.objects.values()].filter((object) => object.kind === kind)).toEqual(objects);
    expect(created).toBe(1); expect(await f.runtime.api.runningTaskCount(f.projectId)).toBe(2);
    expect((await f.runtime.api.createNativeExecution(request)).id).toBe(child.id);
  });

  test('创建失败后的清理可跨作业耗尽重试接续，成功后只释放自身额度', async () => {
    f = await rebuildFixture({ running: true }); const child = await f.runtime.api.createNativeExecution(input());
    const create = f.k8s.create, remove = f.k8s.delete;
    f.k8s.create = async (object) => { if (object.kind === 'Pod') throw precondition('所选套餐当前不可用'); return create(object); };
    await f.runNative(); expect((await f.runtime.api.getEnvironment(child.id))?.native?.state).toBe('cleaning');
    f.k8s.delete = async () => { throw new Error('cleanup unavailable'); };
    await f.tdb.db.execute(sql`UPDATE platform_infra.jobs SET max_attempts = 1, run_at = now() - interval '1 second' WHERE state = 'pending'`);
    await f.runNative(); expect(await f.runtime.api.runningTaskCount(f.projectId)).toBe(2);
    expect([...await f.tdb.db.execute(sql`SELECT state FROM platform_infra.jobs WHERE state = 'dead'`)]).toHaveLength(1);
    f.k8s.delete = remove; await f.runtime.api.reconcile(); await f.runNative();
    expect(await f.runtime.api.getEnvironment(child.id)).toMatchObject({ state: 'failed', native: { state: 'finished' }, message: '所选套餐当前不可用' });
    expect(await f.runtime.api.runningTaskCount(f.projectId)).toBe(1);
    expect(await f.k8s.get(Resources.PersistentVolumeClaim!, f.env.pvcName, f.env.namespace)).toBeDefined();
  });

  test('租约接管后旧执行不能提交连接凭据，新执行接续已创建 Pod', async () => {
    f = await rebuildFixture({ running: true }); const child = await f.runtime.api.createNativeExecution(input());
    const { k8s, tdb } = f, create = k8s.create; let stolen = false;
    k8s.create = async (object) => {
      const result = await create(object);
      if (object.kind === 'Pod' && !stolen) {
        stolen = true;
        await tdb.db.execute(sql`UPDATE platform_infra.jobs SET lease_until = now() - interval '1 second' WHERE state = 'running'`);
        expect(await claimJobs(tdb.db, [NATIVE_EXECUTION_JOB_KIND], 'other-controller', 0, 1)).toHaveLength(1);
      }
      return result;
    };
    await f.runNative(); expect((await f.runtime.api.getEnvironment(child.id))?.native?.state).toBe('queued');
    const pod = structuredClone(await k8s.get(Resources.Pod!, child.podName, f.env.namespace));
    await f.nextNativeAttempt();
    expect((await f.runtime.api.getEnvironment(child.id))?.native?.state).toBe('starting');
    expect(await k8s.get(Resources.Pod!, child.podName, f.env.namespace)).toEqual(pod);
    expect(await f.runtime.api.runningTaskCount(f.projectId)).toBe(2);
  });

  test('删除已受理但尚未消失的子 Pod 时，不提前释放配额或删除父卷', async () => {
    f = await rebuildFixture({ running: true }); const child = await f.runtime.api.createNativeExecution(input()); await f.runNative();
    const remove = f.k8s.delete;
    f.k8s.delete = async (ref, name, ns, options) => {
      if (ref.kind === 'Pod' && name === child.podName) {
        await f!.k8s.mergePatch(ref, name, ns, { metadata: { deletionTimestamp: '2026-09-15T12:00:00Z' } }); return true;
      }
      return remove(ref, name, ns, options);
    };
    await f.runtime.api.releaseEnvironment(f.env.id, 'user'); await f.runNative(); await f.runNative();
    expect(await f.runtime.api.runningTaskCount(f.projectId)).toBe(2);
    expect(await f.k8s.get(Resources.PersistentVolumeClaim!, f.env.pvcName, f.env.namespace)).toBeDefined();
    f.k8s.delete = remove;
    for (let i = 0; i < 4; i++) await f.nextNativeAttempt();
    expect(await f.runtime.api.runningTaskCount(f.projectId)).toBe(0);
    expect((await f.runtime.api.getEnvironment(f.env.id))?.state).toBe('released');
  });

  test('创建后发现原卷已替换，只清理本次容器，两个卷均不删除', async () => {
    f = await rebuildFixture({ running: true }); const { k8s, env } = f;
    const child = await f.runtime.api.createNativeExecution(input()), create = k8s.create;
    k8s.create = async (object) => {
      const result = await create(object);
      if (object.kind === 'Pod') await k8s.mergePatch(Resources.PersistentVolumeClaim!, env.pvcName, env.namespace, { metadata: { uid: 'replacement-workspace' } });
      return result;
    };
    await f.runNative(); await f.nextNativeAttempt();
    expect(await f.runtime.api.getEnvironment(child.id)).toMatchObject({ state: 'failed', native: { state: 'finished' } });
    expect(k8s.deleted.some((key) => key.includes('PersistentVolumeClaim'))).toBe(false);
    expect((await k8s.get(Resources.PersistentVolumeClaim!, env.pvcName, env.namespace))?.metadata.uid).toBe('replacement-workspace');
  });

  test('同名异主 Pod 不覆盖不删除，不能把未完成清理的额度当作空闲', async () => {
    f = await rebuildFixture({ running: true }); const child = await f.runtime.api.createNativeExecution(input());
    await f.k8s.create({ apiVersion: 'v1', kind: 'Pod', metadata: { name: child.podName, namespace: f.env.namespace, labels: { 'crewstation.io/task': 'another-task' } } });
    const before = structuredClone(await f.k8s.get(Resources.Pod!, child.podName, f.env.namespace));
    await f.runNative(); await f.nextNativeAttempt();
    expect((await f.runtime.api.getEnvironment(child.id))?.native?.state).toBe('cleaning');
    expect(await f.k8s.get(Resources.Pod!, child.podName, f.env.namespace)).toEqual(before);
    expect(await f.runtime.api.runningTaskCount(f.projectId)).toBe(2);
  });

  test('不支持多 Pod 的卷和缺失套餐在准入前拒绝，父子互嵌也被拒绝', async () => {
    f = await rebuildFixture({ running: true }); const { runtime, k8s, env } = f;
    await expect(runtime.api.createNativeExecution({ ...input(), profile: 'removed-profile' })).rejects.toThrow('资源套餐 removed-profile 不存在');
    await k8s.mergePatch(Resources.PersistentVolumeClaim!, env.pvcName, env.namespace, { spec: { accessModes: ['ReadWriteOncePod'] } });
    await expect(runtime.api.createNativeExecution(input())).rejects.toThrow('共享写入');
    expect(await runtime.api.runningTaskCount(f.projectId)).toBe(1);
    await k8s.mergePatch(Resources.PersistentVolumeClaim!, env.pvcName, env.namespace, { spec: { accessModes: ['ReadWriteOnce'] } });
    const child = await runtime.api.createNativeExecution(input());
    await expect(runtime.api.createNativeExecution({ ...input(), parentTaskId: child.id })).rejects.toThrow('工作区未连接');
  });
});
