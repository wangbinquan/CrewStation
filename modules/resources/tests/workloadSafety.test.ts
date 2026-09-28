import { afterEach, describe, expect, test } from 'bun:test';
import type { WorkloadConsumer, WorkloadStopProof } from '@crewstation/contracts';
import { ResourceIdSchema, TaskIdSchema, WorkloadStopProofSchema } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import type { Harness } from './fixtures';
import { createHarness, PROJECT, workspace } from './fixtures';
import { workloadSafetyRepository } from '../adapters/persistence/safety/repository';
import { sql } from 'drizzle-orm';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-035 task-owned volume consumer safety', () => {
  let h: Harness;
  afterEach(async () => { await h?.database.drop(); });
  async function fixture() {
    h = await createHarness();
    const owner = h.module.api.owner('task-runtime');
    const parent = await owner.declare(workspace('parent', { kind: 'business-workspace', purpose: 'business-workspace', spec: { children: [{ kind: 'Pod', namespace: 'cs-demo', name: 'parent-start-1' }] } }));
    const consumer: WorkloadConsumer = { id: ResourceIdSchema.parse(newResourceId()), resourceId: ResourceIdSchema.parse(parent.id), taskId: TaskIdSchema.parse(parent.id), revision: 1,
      namespace: 'cs-demo', podName: 'parent-start-1', volumeUid: crypto.randomUUID(), purpose: 'business', finalization: null };
    const permit = { podUid: crypto.randomUUID(), nodeName: 'node-1', nodeUid: crypto.randomUUID() };
    await owner.declare({ kind: 'volume', projectId: PROJECT, ref: `${parent.id}/work`, parentId: parent.id,
      spec: { reclaim: 'retain', taskStorage: { taskId: parent.id, completionPolicy: 'archive-and-delete' }, children: [{ kind: 'PersistentVolumeClaim', namespace: 'cs-demo', name: 'work' }] } });
    await h.module.api.observe({ child: { kind: 'PersistentVolumeClaim', namespace: 'cs-demo', name: 'work', uid: consumer.volumeUid, phase: 'Bound', ready: true } });
    const safety = h.module.api.workloadSafety;
    return { owner, consumer, permit, safety, parent };
  }
  test('closing wins or records the exact writer; a lease or Pod disappearance can never erase that writer', async () => {
    const { consumer, permit, safety } = await fixture();
    await safety.register(consumer);
    const [start] = await Promise.allSettled([safety.grantStart(consumer.id, permit), safety.closeConsumer(consumer.id)]);
    const stopped = await safety.get(consumer.id);
    expect(stopped?.admissionClosed).toBe(true);
    expect(stopped?.stopProof).toBeNull();
    expect(stopped?.startPermit?.podUid ?? null).toBe(start.status === 'fulfilled' ? permit.podUid : null);
    await expect(safety.grantStart(consumer.id, permit)).rejects.toMatchObject({ details: { code: 'workload_admission_closed' } });
    h.clock.advance(365 * 86400_000);
    expect(await workloadSafetyRepository(h.database.db).get(consumer.id)).toEqual(stopped);
    expect(await safety.register(consumer)).toEqual(stopped!);
  });
  test('freeze blocks registration and late starts; archive helpers bind the exact operation revision', async () => {
    const { consumer, permit, safety, owner, parent } = await fixture();
    await safety.register(consumer);
    const finalization = { operationId: newResourceId(), revision: 1 };
    await safety.freezeTask(parent.id, finalization); await safety.freezeTask(parent.id, finalization);
    await expect(safety.grantStart(consumer.id, permit)).rejects.toMatchObject({ details: { code: 'workload_admission_closed' } });
    const helper = await owner.declare({ kind: 'agent-execution', ref: 'archive', projectId: PROJECT, parentId: parent.id, spec: { children: [{ kind: 'Pod', namespace: 'cs-demo', name: 'archive-1' }] } });
    const archive: WorkloadConsumer = { ...consumer, id: ResourceIdSchema.parse(newResourceId()), resourceId: ResourceIdSchema.parse(helper.id), podName: 'archive-1', purpose: 'archive', finalization };
    await expect(safety.register({ ...archive, purpose: 'agent', finalization: null })).rejects.toMatchObject({ details: { code: 'task_finalizing' } });
    expect(await safety.register(archive)).toMatchObject({ admissionClosed: false });
    await safety.grantStart(archive.id, permit);
    await safety.freezeTask(parent.id, { ...finalization, revision: 2 });
    await expect(safety.grantStart(archive.id, permit)).rejects.toMatchObject({ details: { code: 'workload_admission_closed' } });
    expect((await safety.get(archive.id))?.startPermit?.podUid).toBe(permit.podUid);
    await expect(safety.freezeTask(parent.id, finalization)).rejects.toMatchObject({ kind: 'conflict' });
    await expect(safety.freezeTask(parent.id, { ...finalization, operationId: newResourceId(), revision: 2 })).rejects.toMatchObject({ kind: 'conflict' });
  });
  test('a durable proof binds every identity and is immutable across retries and resource compaction', async () => {
    const { consumer, permit, safety, parent } = await fixture();
    await safety.register(consumer); await safety.grantStart(consumer.id, permit);
    const proof: WorkloadStopProof = { id: newResourceId(), consumer, ...permit, type: 'kubelet-terminated', podResourceVersion: '44', observedAt: new Date().toISOString(),
      containers: [{ kind: 'container', name: 'runner', state: 'terminated', containerId: 'containerd://one', exitCode: 0 }] };
    for (const patch of [{ podUid: crypto.randomUUID() }, { nodeUid: crypto.randomUUID() }, { consumer: { ...consumer, volumeUid: crypto.randomUUID() } }]) {
      await expect(safety.recordStop({ ...proof, ...patch })).rejects.toMatchObject({ kind: 'conflict' });
    }
    expect(await safety.recordStop(proof)).toEqual(proof);
    expect(await safety.recordStop({ ...proof, id: newResourceId(), podResourceVersion: '45' })).toEqual(proof);
    expect((await safety.get(consumer.id))?.admissionClosed).toBe(true);
    await expect(safety.grantStart(consumer.id, permit)).rejects.toMatchObject({ details: { code: 'workload_admission_closed' } });
    await h.database.db.execute(sql`UPDATE resources.records SET spec='{"children":[]}'::jsonb WHERE id=${parent.id}`);
    expect((await workloadSafetyRepository(h.database.db).get(consumer.id))?.stopProof).toEqual(proof);
    expect(WorkloadStopProofSchema.safeParse({ ...proof, containers: [] }).success).toBe(false);
  });
  test('closure without a start grant is a durable no-writer tombstone; wrong ownership and reused Pod names fail', async () => {
    const { consumer, permit, safety, owner, parent } = await fixture();
    await expect(safety.register({ ...consumer, podName: 'unowned' })).rejects.toMatchObject({ kind: 'conflict' });
    await safety.register(consumer);
    await expect(safety.register({ ...consumer, id: ResourceIdSchema.parse(newResourceId()) })).rejects.toMatchObject({ kind: 'conflict' });
    await expect(safety.register({ ...consumer, revision: 2 })).rejects.toMatchObject({ kind: 'conflict' });
    expect(await safety.closeConsumer(consumer.id)).toMatchObject({ admissionClosed: true, startPermit: null, stopProof: null });
    expect(await safety.list(parent.id)).toMatchObject({ items: [{ consumer }], next: null });
    expect(await safety.list(newResourceId())).toEqual({ items: [], next: null });
    await owner.requestRelease(parent.id, { code: 'ended', message: 'done' });
    await expect(safety.grantStart(consumer.id, permit)).rejects.toMatchObject({ kind: 'precondition' });
    expect(await safety.get(newResourceId())).toBeUndefined();
  });
  test('proof persistence failure keeps the consumer open and can be retried without any completion claim', async () => {
    const { consumer, safety } = await fixture(); await safety.register(consumer);
    const proof: WorkloadStopProof = { id: newResourceId(), consumer, podUid: crypto.randomUUID(), nodeName: null, nodeUid: null,
      type: 'never-scheduled', podResourceVersion: '4', observedAt: new Date().toISOString(), containers: [{ kind: 'container', name: 'runner', state: 'never-started', containerId: null, exitCode: null }] };
    await h.database.db.execute(sql`ALTER TABLE resources.workload_stop_proofs ADD CONSTRAINT fail_stop_proof CHECK (false)`);
    await expect(safety.recordStop(proof)).rejects.toThrow();
    expect(await safety.get(consumer.id)).toMatchObject({ admissionClosed: false, stopProof: null });
    await h.database.db.execute(sql`ALTER TABLE resources.workload_stop_proofs DROP CONSTRAINT fail_stop_proof`);
    expect(await safety.recordStop(proof)).toEqual(proof);
  });
  test('closure before registration is durable and rejects a late create even without a Pod or volume', async () => {
    const { consumer, safety, owner, parent } = await fixture();
    await owner.declare(workspace('parent', { id: parent.id, kind: 'business-workspace', purpose: 'business-workspace', spec: { ...parent.spec, workloadConsumerId: consumer.id } }));
    const { volumeUid: _volume, resourceId, namespace, podName, ...intent } = consumer;
    const identity = { consumer: intent, resourceId, namespace, podName };
    await safety.closeAdmission(identity); await workloadSafetyRepository(h.database.db).closeAdmission(identity);
    expect(await safety.admissionClosed(consumer.id)).toBe(true);
    expect(await safety.get(consumer.id)).toBeUndefined();
    await expect(safety.register(consumer)).rejects.toMatchObject({ details: { code: 'workload_admission_closed' } });
    await expect(safety.closeAdmission({ ...identity, podName: 'other' })).rejects.toMatchObject({ kind: 'conflict' });
    await expect(safety.closeAdmission({ ...identity, consumer: { ...intent, id: newResourceId() } })).rejects.toMatchObject({ kind: 'precondition' });
  });
  test('closing an admitted consumer preserves its writer identity and cannot be replaced with another volume', async () => {
    const { consumer, permit, safety } = await fixture();
    await expect(safety.register({ ...consumer, volumeUid: crypto.randomUUID() })).rejects.toMatchObject({ details: { code: 'workspace_volume_changed' } });
    await safety.register(consumer); await safety.grantStart(consumer.id, permit);
    const { volumeUid: _volume, resourceId, namespace, podName, ...intent } = consumer;
    await safety.closeAdmission({ consumer: intent, resourceId, namespace, podName });
    expect(await safety.get(consumer.id)).toMatchObject({ admissionClosed: true, startPermit: permit, stopProof: null });
    await expect(safety.grantStart(consumer.id, { ...permit, podUid: crypto.randomUUID() })).rejects.toMatchObject({ kind: 'precondition' });
  });
  test('a finalization barrier waits for admitted writers, excludes later archive helpers, then seals all helpers', async () => {
    const { consumer, permit, safety, owner, parent } = await fixture();
    await safety.register(consumer); await safety.grantStart(consumer.id, permit);
    const finalization = { operationId: newResourceId(), revision: 1 };
    await expect(safety.scanStopped(parent.id, finalization, 'business')).rejects.toMatchObject({ kind: 'conflict' });
    await safety.freezeTask(parent.id, finalization);
    expect(await safety.scanStopped(parent.id, finalization, 'business')).toMatchObject({ state: 'blocked', count: 0, digest: null, blockedConsumerId: consumer.id });
    await safety.recordStop({ id: newResourceId(), consumer, ...permit, type: 'kubelet-terminated', podResourceVersion: '99', observedAt: new Date().toISOString(), containers: [{ kind: 'container', name: 'runner', state: 'terminated', containerId: 'containerd://done', exitCode: 0 }] });
    const proof = await safety.scanStopped(parent.id, finalization, 'business');
    expect(proof).toMatchObject({ state: 'complete', count: 1, blockedConsumerId: null }); expect(proof.digest).toHaveLength(64);
    const helper = await owner.declare({ kind: 'agent-execution', ref: 'archive', projectId: PROJECT, parentId: parent.id, spec: { children: [{ kind: 'Pod', namespace: 'cs-demo', name: 'archive-1' }] } });
    const archive: WorkloadConsumer = { ...consumer, id: newResourceId(), resourceId: ResourceIdSchema.parse(helper.id), podName: 'archive-1', purpose: 'archive', finalization };
    await safety.register(archive);
    expect(await workloadSafetyRepository(h.database.db).scanStopped(parent.id, finalization, 'business')).toEqual(proof);
    await expect(safety.scanStopped(parent.id, finalization, 'all')).rejects.toMatchObject({ kind: 'precondition' });
    await safety.sealConsumers(parent.id, finalization);
    // A never-admitted archive helper is a tombstone; no kubelet proof or fake Pod UID is invented.
    expect(await safety.scanStopped(parent.id, finalization, 'all')).toMatchObject({ state: 'complete', count: 2 });
    await expect(safety.grantStart(archive.id, permit)).rejects.toMatchObject({ kind: 'precondition' });
    await expect(safety.register({ ...archive, id: newResourceId() })).rejects.toMatchObject({ kind: 'precondition' });
    await expect(safety.freezeTask(parent.id, { ...finalization, revision: 2 })).rejects.toMatchObject({ kind: 'conflict' });
  });
  test('stop scans resume bounded pages across restarts without repeating or skipping historical consumers', async () => {
    const { consumer, safety, parent } = await fixture(), finalization = { operationId: newResourceId(), revision: 1 };
    // Seed a long retained history; registration/ownership is covered above, this probes cursor persistence.
    for (let i = 0; i < 101; i++) {
      const id = newResourceId(), body = { ...consumer, id, podName: `history-${i}` };
      await h.database.db.execute(sql`INSERT INTO resources.workload_consumers (id,task_id,resource_id,namespace,pod_name,consumer,admission_closed) VALUES (${id},${parent.id},${parent.id},'cs-demo',${body.podName},${JSON.stringify(body)}::jsonb,true)`);
    }
    await safety.freezeTask(parent.id, finalization);
    expect(await safety.scanStopped(parent.id, finalization, 'business')).toMatchObject({ state: 'pending', count: 100, digest: null });
    const resumed = workloadSafetyRepository(h.database.db), result = await resumed.scanStopped(parent.id, finalization, 'business');
    expect(result).toMatchObject({ state: 'complete', count: 101 }); expect(result.digest).toHaveLength(64);
    expect(await safety.scanStopped(parent.id, finalization, 'business')).toEqual(result);
  });
});
