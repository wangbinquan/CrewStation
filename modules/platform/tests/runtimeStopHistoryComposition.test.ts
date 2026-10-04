import { describe, expect, test } from 'bun:test';
import { ProjectDeletionContextSchema, ProjectIdSchema, TaskIdSchema, WorkloadConsumerSchema } from '@crewstation/contracts';
import { jsonHash, newResourceId, precondition } from '@crewstation/kernel';
import { createResourcesModule, resourcesMigrations } from '@crewstation/module-resources';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { runtimeProjectStops } from '../application/deletion/runtimeStops';

const available = await testDatabaseAvailable();
/** Actual resource factory and persisted history; Root grants and the original observer fact are controlled. */
async function fixture() {
  const database = await createTestDatabase([resourcesMigrations]);
  const resources = createResourcesModule({ db: database.db, quotas: { limitFor: async () => undefined },
    authorizer: { projectAccess: async () => ({ operate: true }) }, isAdmin: async () => true });
  const projectId = ProjectIdSchema.parse(newResourceId()), taskId = TaskIdSchema.parse(newResourceId());
  const namespace = 'cs-historical-original', podName = 'original-pod', volumeUid = crypto.randomUUID();
  const owner = resources.api.owner('task-runtime');
  await owner.declare({ id: taskId, kind: 'business-workspace', ref: 'original-task', projectId,
    spec: { children: [{ kind: 'Pod', namespace, name: podName }] } });
  await owner.declare({ kind: 'volume', ref: taskId + '/work', projectId, parentId: taskId,
    spec: { reclaim: 'retain', taskStorage: { taskId, completionPolicy: 'archive-and-delete' }, children: [{ kind: 'PersistentVolumeClaim', namespace, name: 'original-work' }] } });
  await resources.api.observe({ child: { kind: 'PersistentVolumeClaim', namespace, name: 'original-work', uid: volumeUid, phase: 'Bound', ready: true } });
  const consumer = WorkloadConsumerSchema.parse({ id: newResourceId(), resourceId: taskId, taskId, revision: 1,
    namespace, podName, volumeUid, purpose: 'business', finalization: null });
  const permit = { podUid: crypto.randomUUID(), nodeName: 'controlled-original-node', nodeUid: crypto.randomUUID() };
  const safety = resources.api.workloadSafety;
  await safety.register(consumer); await safety.grantStart(consumer.id, permit);
  const env = { id: taskId, kind: 'business', namespace, podName, podUid: permit.podUid,
    businessWorkspace: { volumeUid }, render: { start: 1, workloadConsumerId: consumer.id } };
  const context = ProjectDeletionContextSchema.parse({ operationId: newResourceId(), generation: 1, phase: 'stop',
    target: { id: projectId, serviceId: newResourceId(), name: 'Historical original', slug: 'historical-original', namespace, kind: 'DigitalWorker',
      state: 'deleting', revision: '1', prodHost: 'original.invalid', previewHost: 'preview.original.invalid', serviceHost: 'original.service.invalid' },
    confirmed: { participant: 'task-runtime', complete: true, resources: [], references: [], blockers: [], revision: jsonHash('controlled original Root') } });
  let valid = true, invalidateRead = false;
  const ports = runtimeProjectStops({ assertProjectDeletionGrant: async () => { if (!valid) throw precondition('controlled original Root expired'); },
    projectDeletionParticipantContext: async (root) => ProjectDeletionContextSchema.parse({ ...root, confirmed: { ...root.confirmed, participant: 'resources' } }) },
  async () => undefined, { get: async () => { throw new Error('No live Pod in the complete scope'); } }, async () => ({ kind: 'ready' }),
  { ...safety, get: async (id) => { const state = await safety.get(id); if (invalidateRead) valid = false; return state; } });
  const stopped = () => safety.recordStop({ id: newResourceId(), consumer, ...permit, type: 'kubelet-terminated', podResourceVersion: '42',
    observedAt: new Date().toISOString(), containers: [{ kind: 'container', name: 'runner', state: 'terminated', containerId: 'containerd://controlled-original', exitCode: 0 }] });
  return { database, resources, env, context, ports, safety, consumer, stopped, loseGrantDuringRead: () => { invalidateRead = true; } };
}
describe.skipIf(!available)('historical runtime STOP composition (actual PostgreSQL/resources; controlled Root and original observer)', () => {
  test('a reopened resource factory retains the original stop fact after its live Pod is gone; absence or closure alone cannot finish', async () => {
    const f = await fixture();
    try {
      expect(await f.ports.stopped(f.context, f.env)).toBeUndefined();
      await f.safety.closeConsumer(f.consumer.id);
      expect(await f.ports.stopped(f.context, f.env)).toBeUndefined();
      await f.stopped();
      const original = await f.ports.stopped(f.context, f.env);
      expect(original?.digest).toMatch(/^[a-f0-9]{64}$/);
      // A closed persisted writer is sufficient; this older path never created the separate admission tombstone.
      expect(await f.safety.admissionClosed(f.consumer.id)).toBe(false);
      await expect(f.safety.grantStart(f.consumer.id, { podUid: crypto.randomUUID(), nodeName: 'replacement', nodeUid: crypto.randomUUID() })).rejects.toMatchObject({ kind: 'precondition' });
      expect((await f.safety.get(f.consumer.id))?.stopProof?.podUid).toBe(f.env.podUid);
      const reopened = createResourcesModule({ db: f.database.db, quotas: { limitFor: async () => undefined },
        authorizer: { projectAccess: async () => ({ operate: true }) }, isAdmin: async () => true });
      expect(await reopened.api.workloadSafety.get(f.consumer.id)).toEqual(await f.safety.get(f.consumer.id));
      await expect(f.ports.stopped(f.context, { ...f.env, podUid: crypto.randomUUID() })).rejects.toMatchObject({ kind: 'precondition' });
    } finally { await f.database.drop(); }
  });
  test('the original Root must remain current after the persisted history read', async () => {
    const f = await fixture();
    try {
      await f.stopped(); f.loseGrantDuringRead();
      await expect(f.ports.stopped(f.context, f.env)).rejects.toMatchObject({ kind: 'precondition' });
      expect((await f.safety.get(f.consumer.id))?.stopProof?.podUid).toBe(f.env.podUid);
    } finally { await f.database.drop(); }
  });
});
