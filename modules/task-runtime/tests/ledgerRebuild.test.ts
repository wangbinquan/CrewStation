import { describe, expect, test } from 'bun:test';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { createClusterControlModule } from '@crewstation/module-cluster-control';
import type { K8sObject } from '@crewstation/k8s';
import { Resources } from '@crewstation/k8s';
import type { TaskId, UserId } from '@crewstation/contracts';
import { rebuildFixture } from './rebuildFixture';

const available = await testDatabaseAvailable();

/** 通过两个模块公开接口连接；台账变更触发真实调和器，物理写落到假集群。 */
async function controller(f: Awaited<ReturnType<typeof rebuildFixture>>) {
  const ledger = f.resources!.api;
  const objects = () => [...f.k8s.objects.values()];
  let finish!: () => void, fail!: (error: unknown) => void;
  const applied = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
  const control = createClusterControlModule({ k8s: f.k8s, systemNamespace: 'cs-system', isAdmin: async () => true, orphanSweep: false,
    legacy: { resolveTaskId: async () => undefined, task: async () => undefined },
    ledger: { ...ledger, listLive: () => ledger.list({}), children: (parentId) => ledger.list({ parentId, includeStopped: true }), adoptOrphanVolume: async () => {} },
    feed: { start: () => {}, stop: async () => {}, synced: async () => {}, cached: (kind, ns, name) => objects().find((o) => o.kind === kind && o.metadata.namespace === ns && o.metadata.name === name), list: (kind) => objects().filter((o) => o.kind === kind) },
    workloads: { ...f.runtime.api, reconcileRebuild: async (id, rebuildId, ops, heartbeat) => {
      try { await f.runtime.api.reconcileRebuild(id as TaskId, rebuildId, ops, heartbeat); finish(); } catch (error) { fail(error); throw error; }
    } },
  });
  control.observer.start();
  try { await applied; await control.reconciled(); } finally { await control.observer.stop(); }
}

describe.skipIf(!available)('保卷重建交给资源调和器（RFC-025 T6）', () => {
  test('受理不建对象也不走旧队列；调和器复用原卷，无检出，绑定令牌并等新 Runner', async () => {
    const f = await rebuildFixture({ ledger: true });
    try {
      const input = await f.request(), record = await f.runtime.api.requestRebuild(f.projectId, input);
      const accepted = (await f.uow.read.environments.getById(f.env.id))!;
      expect(await f.k8s.get(Resources.Pod!, accepted.podName, accepted.namespace)).toBeUndefined();
      await f.run();
      expect((await f.runtime.api.getRebuild(f.env.id))?.state).toBe('queued');
      expect((await f.resources!.api.get(f.env.id))?.spec['rebuild']).toMatchObject({ id: record.id, volumeUid: input.expectedVolumeUid });
      await controller(f);
      const ready = (await f.uow.read.environments.getById(f.env.id))!;
      const pod = (await f.k8s.get(Resources.Pod!, ready.podName, ready.namespace))!;
      expect((pod.spec as { initContainers?: unknown[] }).initContainers ?? []).toEqual([]);
      expect(await f.k8s.get(Resources.Pod!, f.env.podName, f.env.namespace)).toBeUndefined();
      expect((await f.k8s.get(Resources.PersistentVolumeClaim!, f.env.pvcName, f.env.namespace))?.metadata.uid).toBe(input.expectedVolumeUid);
      expect(f.state.checkoutCalls).toBe(1);
      expect(ready.render?.previewRoute?.middlewares).toHaveLength(2);
      expect((await f.resources!.api.get(f.env.id))?.conditions).toContainEqual(expect.objectContaining({ type: 'Provisioning', status: 'false' }));
      expect((await f.runtime.api.getRebuild(f.env.id))?.state).toBe('starting');
      expect(ready.startup?.stages.find((s) => s.kind === 'queue')?.state).toBe('succeeded');
      const secret = await f.k8s.get<K8sObject & { stringData: Record<string, string> }>(Resources.Secret!, `${ready.podName}-runner`, ready.namespace);
      expect(await f.runtime.api.onRunnerConnected(f.env.id, secret!.stringData.CS_RUNNER_TOKEN!)).toBe(true);
      expect((await f.runtime.api.getRebuild(f.env.id))?.state).toBe('ready');
    } finally { await f.close(); }
  });

  test('创建回执丢失后按同一 Secret 接续，不能重签令牌；启动失败由调和器补偿且保留卷', async () => {
    const f = await rebuildFixture({ ledger: true });
    try {
      const input = await f.request(); await f.runtime.api.requestRebuild(f.projectId, input);
      const create = f.k8s.create.bind(f.k8s); let lost = false;
      f.k8s.create = async (object) => { const result = await create(object); if (object.kind === 'Secret' && !lost) { lost = true; throw new Error('reply lost'); } return result; };
      await expect(controller(f)).rejects.toThrow('恢复尚未完成');
      const env = (await f.uow.read.environments.getById(f.env.id))!;
      const before = await f.k8s.get(Resources.Secret!, `${env.podName}-runner`, env.namespace);
      expect((await f.uow.read.rebuilds.get(env.rebuildId!))?.attempts).toBe(1);
      await controller(f);
      expect(await f.k8s.get(Resources.Secret!, `${env.podName}-runner`, env.namespace)).toEqual(before);
      await f.runtime.api.markFailed(f.env.id, '新环境连接失败');
      await controller(f);
      expect((await f.runtime.api.getRebuild(f.env.id))?.state).toBe('failed');
      expect(await f.k8s.get(Resources.Pod!, env.podName, env.namespace)).toBeUndefined();
      expect(await f.k8s.get(Resources.Secret!, `${env.podName}-runner`, env.namespace)).toBeUndefined();
      expect((await f.k8s.get(Resources.PersistentVolumeClaim!, env.pvcName, env.namespace))?.metadata.uid).toBe(input.expectedVolumeUid);
    } finally { await f.close(); }
  });
  test('五次临时失败持久计数，下一轮补偿；租约失效不计失败也不进行创建', async () => {
    const f = await rebuildFixture({ ledger: true });
    try {
      await f.runtime.api.requestRebuild(f.projectId, await f.request());
      const env = (await f.uow.read.environments.getById(f.env.id))!;
      let writes = 0;
      const ops = { prepareSecret: async () => { writes++; throw new Error('offline'); }, ensurePod: async () => 'unused', ensurePreview: async () => {}, cleanup: async () => { writes++; } };
      await expect(f.runtime.api.reconcileRebuild(f.env.id, env.rebuildId!, ops, async () => false)).rejects.toThrow('租约');
      expect(writes).toBe(0);
      expect((await f.uow.read.rebuilds.get(env.rebuildId!))?.attempts).toBe(0);
      for (let attempt = 1; attempt <= 5; attempt++) {
        await expect(f.runtime.api.reconcileRebuild(f.env.id, env.rebuildId!, ops, async () => true)).rejects.toThrow('恢复尚未完成');
        expect((await f.uow.read.rebuilds.get(env.rebuildId!))?.attempts).toBe(attempt);
      }
      expect((await f.uow.read.rebuilds.get(env.rebuildId!))?.failureReason).toContain('新环境准备失败');
      await controller(f);
      expect((await f.runtime.api.getRebuild(f.env.id))?.state).toBe('failed');
      expect(await f.k8s.get(Resources.PersistentVolumeClaim!, env.pvcName, env.namespace)).toBeDefined();
    } finally { await f.close(); }
  });

  test('受理后工作卷 UID 变化立即停止，补偿不删除替换卷', async () => {
    const f = await rebuildFixture({ ledger: true });
    try {
      await f.runtime.api.requestRebuild(f.projectId, await f.request());
      await f.k8s.mergePatch(Resources.PersistentVolumeClaim!, f.env.pvcName, f.env.namespace, { metadata: { uid: 'other-volume' } });
      await expect(controller(f)).rejects.toThrow('恢复尚未完成');
      const env = (await f.uow.read.environments.getById(f.env.id))!;
      expect((await f.uow.read.rebuilds.get(env.rebuildId!))?.failureReason).toContain('工作卷实例已变化');
      await controller(f);
      expect((await f.runtime.api.getRebuild(f.env.id))?.state).toBe('failed');
      expect((await f.k8s.get(Resources.PersistentVolumeClaim!, env.pvcName, env.namespace))?.metadata.uid).toBe('other-volume');
    } finally { await f.close(); }
  });

  test('管理员重建等待子 CLI 结束，不消耗重试次数；保留原节点且不重启 CLI', async () => {
    const f = await rebuildFixture({ ledger: true, running: true }); f.state.quota = 3;
    try {
      const child = await f.runtime.api.createNativeExecution({ id: '01a0bf5d-8f4b-780e-826f-c732652342f0' as TaskId, parentTaskId: f.env.id, createdBy: '01a0bf5d-8f4b-7e44-886a-b79b12465703' as UserId, agentId: 'agent', terminalId: 'pty', runnerId: crypto.randomUUID(), fingerprint: 'f'.repeat(64), profile: f.state.profiles[0]!.id });
      const check = await f.runtime.api.inspectRebuild(f.projectId, true), profile = check.profiles[0]!;
      await f.runtime.api.requestRebuild(f.projectId, { requestId: crypto.randomUUID(), expectedTaskId: f.env.id, expectedUpdatedAt: check.updatedAt, expectedPodUid: check.podUid, expectedVolumeUid: check.volume.uid, reason: 'administrator-restart', profile: { id: profile.id, name: profile.name, cpu: profile.cpu, memory: profile.memory, storage: profile.storage } });
      await controller(f);
      expect(await f.k8s.get(Resources.Pod!, f.env.podName, f.env.namespace)).toBeDefined();
      const env = (await f.uow.read.environments.getById(f.env.id))!;
      expect((await f.uow.read.rebuilds.get(env.rebuildId!))?.attempts).toBe(0);
      await f.nextNativeAttempt();
      await controller(f);
      expect((await f.runtime.api.getEnvironment(child.id))?.native?.state).toBe('finished');
      expect((await f.runtime.api.getRebuild(f.env.id))?.state).toBe('starting');
      expect(env.render?.rebuild?.nodeName).toBe('worker-one');
    } finally { await f.close(); }
  });

});
