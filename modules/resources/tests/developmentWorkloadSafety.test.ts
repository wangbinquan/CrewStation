// RFC-034: a protected development writer must retain the original workspace, volume and bound Pod.
import { afterEach, describe, expect, test } from 'bun:test';
import type { WorkloadConsumer } from '@crewstation/contracts';
import { TaskIdSchema } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import type { Harness } from './fixtures';
import { createHarness, OTHER_PROJECT, PROJECT, workspace } from './fixtures';
import { workloadSafetyRepository } from '../adapters/persistence/safety/repository';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-034 original development workload admission', () => {
  let h: Harness;
  afterEach(async () => { await h?.database.drop(); });
  async function fixture(observed = true) {
    h = await createHarness();
    const owner = h.module.api.owner('task-runtime'), parentId = TaskIdSchema.parse(newResourceId()), childId = newResourceId();
    const parentUid = crypto.randomUUID(), volumeUid = crypto.randomUUID(), childUid = crypto.randomUUID();
    const parent = await owner.declare(workspace(parentId, { id: parentId }));
    const volume = await owner.declare({ kind: 'volume', ref: parentId + '/work', projectId: PROJECT, parentId, spec: { children: [{ kind: 'PersistentVolumeClaim', namespace: 'cs-demo', name: 'original-work' }] } });
    const consumer: WorkloadConsumer = { id: newResourceId(), taskId: parentId, resourceId: childId, namespace: 'cs-demo', podName: 'original-agent', revision: 1, purpose: 'agent', finalization: null, volumeUid };
    const { resourceId: _resource, namespace: _namespace, podName: _pod, volumeUid: _volume, ...intent } = consumer;
    const pod = { image: 'task@sha256:original', workerUid: 10001, resources: { cpu: '1', memory: '2Gi', storage: '10Gi' }, workload: 'dev-session', project: 'demo', service: 'demo',
      pvc: 'original-work', secret: 'original-agent-runner', developmentUsageStorage: { version: 1 }, developmentUsageProtection: { version: 1 },
      expectedVolumeUid: volumeUid, consumer: intent, nodeName: 'original-node', workspace: { pod: 'task-' + parentId, podUid: parentUid, pvcUid: volumeUid },
      labels: { 'crewstation.io/workspace-task': parentId }, annotations: { 'crewstation.io/cli-intent': 'a'.repeat(64) } };
    const declaration = { id: childId, kind: 'agent-execution' as const, ref: childId, projectId: PROJECT, parentId, purpose: 'development-agent' as const,
      spec: { children: [{ kind: 'Pod', namespace: 'cs-demo', name: consumer.podName }, { kind: 'Secret', namespace: 'cs-demo', name: pod.secret }, { kind: 'Secret', namespace: 'cs-demo', name: consumer.podName + '-admission' }], workloadConsumerId: consumer.id, pod } };
    await owner.declare(declaration);
    const observe = async () => {
      await h.module.api.observe({ resourceId: parent.id, child: { kind: 'Pod', namespace: 'cs-demo', name: pod.workspace.pod, uid: parentUid, phase: 'Running', ready: true, node: 'original-node' } });
      await h.module.api.observe({ resourceId: volume.id, child: { kind: 'PersistentVolumeClaim', namespace: 'cs-demo', name: pod.pvc, uid: volumeUid, phase: 'Bound', ready: true } });
    };
    if (observed) await observe();
    const bind = () => owner.declare({ ...declaration, spec: { ...declaration.spec, pod: { ...pod, expectedPodUid: childUid } } });
    return { owner, parent, volume, consumer, pod, declaration, observe, bind, safety: h.module.api.workloadSafety, permit: { podUid: childUid, nodeName: 'original-node', nodeUid: crypto.randomUUID() } };
  }
  test('registers the original development consumer, then grants only after its actual Pod UID is durably bound', async () => {
    const f = await fixture();
    expect(await f.safety.register(f.consumer)).toMatchObject({ consumer: f.consumer, admissionClosed: false, startPermit: null });
    await expect(f.safety.grantStart(f.consumer.id, f.permit)).rejects.toMatchObject({ details: { code: 'development_workload_binding_pending' } });
    await f.bind();
    await expect(f.safety.grantStart(f.consumer.id, { ...f.permit, podUid: crypto.randomUUID() })).rejects.toMatchObject({ kind: 'conflict' });
    const granted = await f.safety.grantStart(f.consumer.id, f.permit);
    expect(granted.startPermit).toMatchObject(f.permit);
    expect(await workloadSafetyRepository(h.database.db).register(f.consumer)).toEqual(granted);
    expect(await workloadSafetyRepository(h.database.db).grantStart(f.consumer.id, f.permit)).toEqual(granted);
    expect((await f.safety.list(f.parent.id)).items).toHaveLength(1);
  });
  test('missing initial observations wait without inventing a volume or consumer; observation permits the same identity', async () => {
    const f = await fixture(false);
    await expect(f.safety.register(f.consumer)).rejects.toMatchObject({ details: { code: 'development_workload_pending' } });
    expect(await f.safety.get(f.consumer.id)).toBeUndefined();
    await f.observe();
    expect((await f.safety.register(f.consumer)).consumer).toEqual(f.consumer);
  });
  test('a replay checks original parent and volume again; a same-name replacement cannot borrow the first grant', async () => {
    const f = await fixture(); await f.safety.register(f.consumer); await f.bind();
    await h.module.api.observe({ resourceId: f.parent.id, child: { kind: 'Pod', namespace: 'cs-demo', name: f.pod.workspace.pod, uid: crypto.randomUUID(), phase: 'Running', ready: true, node: 'original-node' } });
    await expect(workloadSafetyRepository(h.database.db).register(f.consumer)).rejects.toMatchObject({ details: { code: 'workspace_volume_changed' } });
    await expect(f.safety.grantStart(f.consumer.id, f.permit)).rejects.toMatchObject({ details: { code: 'workspace_volume_changed' } });
    expect((await f.safety.get(f.consumer.id))?.startPermit).toBeNull();
  });
  test('released, paused and wrongly owned development records cannot be admitted, including prior registration', async () => {
    const f = await fixture(); await f.safety.register(f.consumer); await f.bind();
    await f.owner.report(f.parent.id, { conditions: [{ type: 'Paused', status: 'true' }] });
    await expect(f.safety.register(f.consumer)).rejects.toMatchObject({ details: { code: 'workload_admission_closed' } });
    await expect(f.safety.grantStart(f.consumer.id, f.permit)).rejects.toMatchObject({ details: { code: 'workload_admission_closed' } });
    await f.owner.report(f.parent.id, { conditions: [{ type: 'Paused', status: 'false' }] });
    await f.owner.requestRelease(f.parent.id, { code: 'ended', message: 'original workspace ended' });
    await expect(f.safety.register(f.consumer)).rejects.toMatchObject({ details: { code: 'workload_admission_closed' } });
    expect((await f.safety.closeConsumer(f.consumer.id)).admissionClosed).toBe(true);
    expect((await f.safety.register(f.consumer)).admissionClosed).toBe(true);
  });
  test('protection, consumer tuple and declared children must agree before the first registration', async () => {
    const f = await fixture();
    const patches = [
      { purpose: 'development-cli' as const },
      { spec: { ...f.declaration.spec, pod: { ...f.pod, developmentUsageProtection: { version: 1, extra: true } } } },
      { spec: { ...f.declaration.spec, pod: { ...f.pod, developmentUsageStorage: undefined } } },
      { spec: { ...f.declaration.spec, pod: { ...f.pod, consumer: { ...f.pod.consumer, revision: 2 } } } },
      { spec: { ...f.declaration.spec, pod: { ...f.pod, expectedVolumeUid: crypto.randomUUID() } } },
      { spec: { ...f.declaration.spec, pod: { ...f.pod, businessStorage: { version: 1, ownerTaskId: f.parent.id } } } },
      { spec: { ...f.declaration.spec, children: f.declaration.spec.children.slice(0, 2) } },
      { spec: { ...f.declaration.spec, pod: { ...f.pod, labels: { 'crewstation.io/workspace-task': newResourceId() } } } },
    ];
    for (const patch of patches) {
      await f.owner.declare({ ...f.declaration, ...patch });
      await expect(f.safety.register(f.consumer)).rejects.toThrow();
      expect(await f.safety.get(f.consumer.id)).toBeUndefined();
    }
    const otherId = newResourceId(), other = { ...f.consumer, resourceId: otherId, podName: 'other-agent' };
    await f.owner.declare({ ...f.declaration, id: otherId, ref: otherId, projectId: OTHER_PROJECT, spec: { ...f.declaration.spec,
      children: f.declaration.spec.children.map((c) => ({ ...c, name: c.name.replace('original-agent', 'other-agent') })), pod: { ...f.pod, secret: 'other-agent-runner' } } });
    await expect(f.safety.register(other)).rejects.toMatchObject({ kind: 'conflict' });
    expect(await f.safety.get(f.consumer.id)).toBeUndefined();
    await f.owner.declare(f.declaration);
    expect((await f.safety.register(f.consumer)).consumer).toEqual(f.consumer);
  });
});
