import { describe, expect, test } from 'bun:test';
import type { BusinessStorageFinalization } from '@crewstation/contracts';
import { TaskIdSchema } from '@crewstation/contracts';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { createResourcesModule, resourcesMigrations } from '@crewstation/module-resources';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { drizzleUnitOfWork } from '../../adapters/persistence/drizzleUnitOfWork';
import { archiveExecutionStore } from '../../adapters/persistence/archiveExecutions';
import { runtimeWorkModuleFixture } from './workModuleFixture';

const available = await testDatabaseAvailable();
async function fixture() {
  let resources: ReturnType<typeof createResourcesModule> | undefined;
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(), issued: string[] = [], closed: string[] = [];
  let bounded = false;
  const f = await runtimeWorkModuleFixture(async (original) => {
    resources = createResourcesModule({ db: original.database.db, quotas: { limitFor: async () => 4 },
      authorizer: { projectAccess: async () => ({ operate: true }) }, isAdmin: async () => true });
    const owner = resources.api.owner('task-runtime'), api = resources.api;
    const ledger = { within: (tx: unknown) => owner.within(tx as object), live: async () => (await api.list({})).filter((r) => r.owner.module === 'task-runtime'), occupancy: api.occupancy };
    return { ledger, creation: 'ledger', workloadSafety: api.workloadSafety, taskVolumes: api.taskVolumes,
      archive: { apiUrl: 'http://controlled-api', credentials: { issue: async (input) => {
        issued.push(input.id); if (bounded) { entered.resolve(); await release.promise; } return { token: 'controlled-private-archive-token' };
      }, close: async (id) => { closed.push(id); }, bind: async () => undefined } },
      sources: { pinTaskImage: async () => 'controlled@sha256:' + 'a'.repeat(64), configEnv: async () => ({}), dataEnv: async () => ({}), taskDataEnv: async () => ({}) } };
  }, [resourcesMigrations]);
  const api = resources!.api, uow = drizzleUnitOfWork(f.database.db, { ledger: f.dependencies.ledger! });
  try {
    const taskId = TaskIdSchema.parse(newResourceId()); f.bind('business-task', taskId);
    await f.module.api.createEnvironment({ serviceId: f.service, kind: 'business', volumeMode: 'persistent', businessStorage: 'isolated-v1', completionPolicy: 'archive-and-delete',
      admission: { id: taskId, fingerprint: 'b'.repeat(64) } });
    const input: BusinessStorageFinalization = { taskId, projectId: f.project, serviceId: f.service, operationId: newResourceId(), revision: 1, volumeUid: crypto.randomUUID() };
    const parent = (await uow.read.environments.getById(taskId))!, volume = await api.taskVolumes.forTask(taskId);
    await api.taskVolumes.beginProvision(volume.resourceId);
    await api.taskVolumes.recordTarget(volume.resourceId, { kind: 'local-path', namespace: parent.namespace, name: parent.pvcName, uid: input.volumeUid!, pvName: 'controlled-pv',
      pvUid: 'controlled-pv-uid', nodeName: 'controlled-node', nodeUid: 'controlled-node-uid', root: '/controlled-volumes', directory: 'controlled-work' });
    await api.observe({ child: { kind: 'PersistentVolumeClaim', name: parent.pvcName, namespace: parent.namespace, uid: input.volumeUid!, phase: 'Bound', ready: true } });
    await api.workloadSafety.freezeTask(taskId, { operationId: input.operationId, revision: 1 });
    await api.workloadSafety.closeAdmission({ resourceId: taskId, namespace: parent.namespace, podName: parent.podName,
      consumer: { id: parent.render!.workloadConsumerId!, taskId, revision: 1, purpose: 'business', finalization: null } });
    await api.observeConditions(taskId, [{ type: 'WorkloadStopped', status: 'true', reason: parent.render!.workloadConsumerId! }]);
    await uow.run((scope) => scope.environments.update({ ...parent, state: 'releasing', release: { reason: 'business', occupied: false },
      businessWorkspace: { phase: 'paused', volumeUid: input.volumeUid! }, render: { ...parent.render!, storageFinalization: {
        operationId: input.operationId, revision: input.revision, volumeUid: input.volumeUid!, computeStopped: true } } }));
    return { ...f, resources: api, uow, input, entered, release, issued, closed, store: archiveExecutionStore(f.database.db, f.dependencies.ledger!),
      bounded: () => { bounded = true; } };
  } catch (error) { release.resolve(); await f.drop(); throw error; }
}

describe.skipIf(!available)('original TaskRuntime storage work (actual factory and PG; controlled credentials and stop facts)', () => {
  test('archive credentials and binding, then original volume permit and completion, retain actual callback births through the factory', async () => {
    const f = await fixture();
    try {
      const archive = f.module.api.archiveExecution!, cleanup = f.module.api.storageCleanup!, helper = await archive.ensure(f.input);
      expect((await archive.values(helper.id)).CS_ARCHIVE_TOKEN).toBe('controlled-private-archive-token');
      await archive.bind(helper.id, 'controlled-pod-uid', 'controlled-secret-uid');
      expect(await archive.stop(f.input)).toBe(false); expect(f.closed).toEqual([]);
      const original = (await f.store.get(helper.id))!;
      await f.resources.observeConditions(helper.id, [{ type: 'WorkloadStopped', status: 'true', reason: original.consumerId }]);
      expect(await archive.stop(f.input)).toBe(true); expect(f.closed).toEqual([helper.id]);
      const barrier = await cleanup.prepare(f.input); expect(barrier.state).toBe('complete');
      const permit = { id: f.input.operationId, taskId: f.input.taskId, operationId: f.input.operationId, revision: 1,
        receiptId: newResourceId(), volumeUid: f.input.volumeUid, allConsumersStoppedDigest: barrier.digest! };
      await cleanup.release(f.input, permit); expect(await cleanup.proof(f.input)).toBeNull();
      await expect(cleanup.complete(f.input, newResourceId())).rejects.toThrow('尚未持久确认');
      const volume = await f.resources.taskVolumes.forTask(f.input.taskId), proof = { id: newResourceId(), permitId: permit.id, volumeUid: f.input.volumeUid,
        pvUid: 'controlled-pv-uid', disposition: 'deleted' as const, storageReclaimed: true as const, source: 'local-path-probe' as const, observedAt: new Date().toISOString() };
      await f.resources.taskVolumes.recordReclaimed(volume.resourceId, proof); await cleanup.complete(f.input, proof.id);
      expect(await cleanup.proof(f.input)).toEqual(proof); expect((await f.module.api.getEnvironment(f.input.taskId))?.state).toBe('released');
      await f.stop(); const history = await f.work.history(f.project);
      expect(history.filter((row) => row.kind === 'archive')).toHaveLength(5);
      expect(history.filter((row) => row.kind === 'task-api')).toHaveLength(6);
      expect(history.some((row) => row.kind === 'effect')).toBe(true); expect(history.every((row) => row.exited)).toBe(true);
      expect(JSON.stringify(history)).not.toContain('controlled-private-archive-token');
    } finally { f.release.resolve(); await f.drop(); }
  });

  test('a detached archive credential request holds the project seal until its real finally; sealed nested APIs issue no new resource writes', async () => {
    const f = await fixture(); let issuing: Promise<unknown> | undefined, sealing: Promise<unknown> | undefined;
    try {
      const archive = f.module.api.archiveExecution!, cleanup = f.module.api.storageCleanup!, helper = await archive.ensure(f.input);
      f.bounded(); issuing = archive.values(helper.id); await f.entered.promise;
      expect(await Promise.race([issuing, Promise.resolve('HTTP caller deadline')])).toBe('HTTP caller deadline');
      sealing = f.seal(); await f.waitSeal();
      expect((await f.work.history(f.project)).some((row) => row.kind === 'archive' && !row.exited)).toBe(true);
      expect((await f.module.api.createEnvironment({ serviceId: f.otherService, kind: 'business' })).projectId).toBe(f.otherProject);
      f.release.resolve(); await issuing; await f.stop(); await sealing;
      const before = jsonHash(await f.resources.list({})), issued = [...f.issued];
      for (const request of [() => archive.ensure(f.input), () => archive.stop(f.input), () => archive.values(helper.id),
        () => archive.bind(helper.id, 'late-pod', 'late-secret'), () => cleanup.prepare(f.input), () => cleanup.proof(f.input), () => cleanup.complete(f.input, newResourceId())])
        await expect(request()).rejects.toThrow('永久封闭');
      expect(f.issued).toEqual(issued); expect(f.closed).toEqual([]); expect(jsonHash(await f.resources.list({}))).toBe(before);
      expect((await f.work.history(f.project)).every((row) => row.exited)).toBe(true);
      await expect(archive.values(newResourceId())).rejects.toThrow('实际原任务');
    } finally { f.release.resolve(); await issuing; await sealing; await f.drop(); }
  });
});
