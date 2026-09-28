import { afterEach, describe, expect, test } from 'bun:test';
import { ResourceIdSchema, TaskIdSchema } from '@crewstation/contracts';
import type { TaskVolumeTarget } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import type { Harness } from './fixtures';
import { createHarness, PROJECT, workspace } from './fixtures';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('durable task volume delete permits', () => {
  let h: Harness;
  afterEach(async () => { await h?.database.drop(); });
  async function fixture() {
    h = await createHarness();
    const owner = h.module.api.owner('task-runtime'), id = TaskIdSchema.parse(newResourceId());
    await owner.declare(workspace(id, { id, kind: 'business-workspace', purpose: 'business-workspace' }));
    const volume = await owner.declare({ kind: 'volume', ref: `${id}/work`, parentId: id, projectId: PROJECT, spec: { children: [{ kind: 'PersistentVolumeClaim', namespace: 'cs-demo', name: 'work' }], reclaim: 'retain', taskStorage: { taskId: id, completionPolicy: 'archive-and-delete' } } });
    const port = h.module.api.taskVolumes, safety = h.module.api.workloadSafety, fence = { operationId: ResourceIdSchema.parse(newResourceId()), revision: 1 };
    const barrier = async () => { await safety.freezeTask(id, fence); await safety.sealConsumers(id, fence); return (await safety.scanStopped(id, fence, 'all')).digest!; };
    const target: TaskVolumeTarget = { kind: 'local-path', namespace: 'cs-demo', name: 'work', uid: crypto.randomUUID(), pvName: 'pv', pvUid: crypto.randomUUID(), nodeName: 'node', nodeUid: crypto.randomUUID(), root: '/volumes', directory: 'pvc-original' };
    const permit = (digest: string, volumeUid: string | null = target.uid) => ({ id: fence.operationId, taskId: id, ...fence, receiptId: ResourceIdSchema.parse(newResourceId()), volumeUid, allConsumersStoppedDigest: digest });
    return { owner, id, volume, port, safety, fence, barrier, target, permit };
  }
  test('only a sealed complete consumer set and original physical target allow release; PVC disappearance is not reclaimed', async () => {
    const f = await fixture(); await f.port.beginProvision(f.volume.id); await f.port.recordTarget(f.volume.id, f.target);
    await expect(f.port.permitDeletion(f.volume.id, f.permit('a'.repeat(64)))).rejects.toMatchObject({ kind: 'precondition' });
    const digest = await f.barrier(), permit = f.permit(digest);
    await expect(f.port.permitDeletion(f.volume.id, { ...permit, volumeUid: 'replacement' })).rejects.toMatchObject({ kind: 'precondition' });
    await f.port.permitDeletion(f.volume.id, permit); await f.port.permitDeletion(f.volume.id, permit);
    expect(await h.module.api.get(f.volume.id)).toMatchObject({ desired: 'absent', phase: 'stopping' });
    expect((await f.port.forTask(f.id)).proof).toBeNull();
    await expect(f.port.beginProvision(f.volume.id)).rejects.toMatchObject({ kind: 'precondition' });
    await expect(f.port.recordTarget(f.volume.id, { ...f.target, pvUid: 'replacement' })).rejects.toMatchObject({ kind: 'conflict' });
    const proof = { id: newResourceId(), permitId: permit.id, volumeUid: f.target.uid, pvUid: f.target.pvUid, disposition: 'deleted' as const, storageReclaimed: true as const, source: 'local-path-probe' as const, observedAt: new Date().toISOString() };
    await expect(f.port.recordReclaimed(f.volume.id, { ...proof, pvUid: 'replacement' })).rejects.toMatchObject({ kind: 'conflict' });
    await f.port.recordReclaimed(f.volume.id, proof);
    expect(await h.module.api.get(f.volume.id)).toMatchObject({ phase: 'stopped' });
    expect((await f.port.get(f.volume.id)).proof).toEqual(proof);
    // Public owner APIs cannot issue a permit or manufacture physical evidence.
    await expect(f.owner.report(f.volume.id, { conditions: [{ type: 'StorageReclaimed', status: 'true' }] })).rejects.toThrow();
    await expect(f.owner.requestRelease(f.volume.id, { code: 'generic', message: 'bypass' })).rejects.toThrow();
  });
  test('no create admission gives a never-provisioned tombstone; a lost create response permanently blocks that shortcut', async () => {
    const f = await fixture(), permit = f.permit(await f.barrier(), null);
    await f.port.permitDeletion(f.volume.id, permit);
    await f.port.recordReclaimed(f.volume.id, { id: newResourceId(), permitId: permit.id, volumeUid: null, pvUid: null, disposition: 'never-provisioned', storageReclaimed: null, source: 'never-provisioned', observedAt: new Date().toISOString() });
    expect((await f.port.get(f.volume.id)).proof).toMatchObject({ disposition: 'never-provisioned', storageReclaimed: null });
    await expect(f.port.beginProvision(f.volume.id)).rejects.toThrow();
    const second = await f.owner.declare({ kind: 'volume', ref: 'unclaimed', spec: { children: [] } });
    await expect(f.port.get(second.id)).rejects.toMatchObject({ kind: 'not_found' });
  });
  test('ambiguous creation and late recorded physical target cannot be rewritten as empty', async () => {
    const f = await fixture(); await f.port.beginProvision(f.volume.id);
    const permit = f.permit(await f.barrier(), null);
    await expect(f.port.permitDeletion(f.volume.id, permit)).rejects.toMatchObject({ details: { code: 'volume_reclaim_unavailable' } });
    expect(await f.port.get(f.volume.id)).toMatchObject({ provisionIssued: true, permit: null, proof: null });
    await f.port.recordTarget(f.volume.id, f.target);
    expect((await f.port.get(f.volume.id)).target?.uid).toBe(f.target.uid);
    await expect(f.port.permitDeletion(f.volume.id, permit)).rejects.toThrow();
    expect((await h.module.api.get(f.volume.id))?.desired).toBe('present');
  });
  test('a started consumer without stop proof prevents sealing from authorizing deletion', async () => {
    const f = await fixture(); await f.port.beginProvision(f.volume.id); await f.port.recordTarget(f.volume.id, f.target);
    await h.module.api.observe({ child: { kind: 'PersistentVolumeClaim', namespace: 'cs-demo', name: 'work', uid: f.target.uid, phase: 'Bound', ready: true } });
    const consumer = { id: ResourceIdSchema.parse(newResourceId()), resourceId: ResourceIdSchema.parse(f.id), taskId: f.id, namespace: 'cs-demo', podName: `task-${f.id}`, volumeUid: f.target.uid, revision: 1, purpose: 'business' as const, finalization: null };
    await f.safety.register(consumer); await f.safety.grantStart(consumer.id, { podUid: crypto.randomUUID(), nodeName: 'node', nodeUid: crypto.randomUUID() });
    expect(await f.barrier()).toBeNull();
    await expect(f.port.permitDeletion(f.volume.id, f.permit('a'.repeat(64)))).rejects.toThrow();
    expect((await h.module.api.get(f.volume.id))?.desired).toBe('present');
  });
  test('a Pending PVC pins identity but cannot issue a deletion permit until its actual PV supplier is recorded', async () => {
    const f = await fixture(); await f.port.beginProvision(f.volume.id);
    const claim = { namespace: f.target.namespace, name: f.target.name, uid: f.target.uid };
    await f.port.recordClaim(f.volume.id, claim); await f.port.recordClaim(f.volume.id, claim);
    expect(await f.port.forTask(f.id)).toMatchObject({ claim, target: null, provisionIssued: true });
    await expect(f.port.recordClaim(f.volume.id, { ...claim, uid: 'replacement' })).rejects.toMatchObject({ kind: 'conflict' });
    await expect(f.port.recordTarget(f.volume.id, { ...f.target, uid: 'replacement' })).rejects.toMatchObject({ kind: 'conflict' });
    const permit = f.permit(await f.barrier());
    await expect(f.port.permitDeletion(f.volume.id, permit)).rejects.toMatchObject({ details: { code: 'volume_reclaim_unavailable' } });
    await f.port.recordTarget(f.volume.id, f.target); await f.port.permitDeletion(f.volume.id, permit);
    expect((await f.port.forTask(f.id)).permit?.volumeUid).toBe(f.target.uid);
  });
});
