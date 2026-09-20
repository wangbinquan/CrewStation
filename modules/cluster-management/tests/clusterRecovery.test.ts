import { afterEach, describe, expect, test } from 'bun:test';
import { IDENTITY_HEADERS } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import { createFakeK8sClient, Resources } from '@crewstation/k8s';
import { PlatformError } from '@crewstation/kernel';
import { queueMigrations } from '@crewstation/queue';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { clusterManagementMigrations, createClusterManagementModule } from '../index';
import { drizzleClusterRepository } from '../adapters/persistence/drizzleRepository';
import { admin, facts, catalog, object, query } from './inventoryFixture';
const available = await testDatabaseAvailable();
let database: TestDatabase | undefined;
afterEach(async () => { await database?.drop(); database = undefined; });
async function setup() {
  database = await createTestDatabase([queueMigrations, clusterManagementMigrations]);
  const k8s = createFakeK8sClient(), data = structuredClone(facts), state = { now: Date.now(), wait: async () => {}, metadataError: false };
  const module = createClusterManagementModule({ db: database.db, k8s, metadata: { read: async () => { if (state.metadataError) throw new Error('metadata unavailable'); return data; } }, domains: { inspect: async () => { throw new Error('unexpected domain'); }, execute: async () => { throw new Error('unexpected domain'); }, observe: async () => { throw new Error('unexpected domain'); } }, isAdmin: async (id) => id === admin.userId, systemNamespace: 'crewstation-system', catalog, instance: 'recovery', clock: { now: () => new Date(state.now) }, observationMs: 100, wait: async () => { state.now += 200; await state.wait(); } });
  const inspect = async (name: string, action: 'delete' | 'restart' = 'delete') => { await module.collect(); const target = (await module.api.resources(admin, query)).items.find((r) => r.name === name)!; return module.api.inspect(admin, target.resourceId, { action }); };
  const accept = async (name: string, action: 'delete' | 'restart' = 'delete') => { const i = await inspect(name, action); return module.api.accept(admin, { inspectionId: i.inspectionId, idempotencyKey: crypto.randomUUID(), params: i.request }); };
  return { k8s, state, data, module, inspect, accept, repository: drizzleClusterRepository(database.db) };
}
describe.skipIf(!available)('durable inventory and operation recovery', () => {
  test('inventory refresh proceeds while a resource operation waits for convergence', async () => {
    const f = await setup();
    await f.k8s.create(object('Deployment', 'cs-api', 'crewstation-system', { replicas: 1, template: { metadata: {}, spec: { containers: [{ name: 'api', image: 'api' }] } } }));
    const first = await f.module.collect(), waiting = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
    f.state.wait = async () => { waiting.resolve(); await resume.promise; };
    const lifecycle = f.module.workers[0]!;
    lifecycle.start();
    try {
      const deadline = Date.now() + 3000;
      while ((await f.repository.latest())?.id === first.id && Date.now() < deadline) await Bun.sleep(10);
      expect((await f.repository.latest())?.id).not.toBe(first.id);
      await f.accept('cs-api', 'restart'); await waiting.promise;
      await f.k8s.create(object('ConfigMap', 'created-during-rollout'));
      await f.module.api.refresh(admin);
      const refreshedBy = Date.now() + 3000;
      let seen = false;
      do { seen = (await f.repository.latest())?.resources.some((r) => r.name === 'created-during-rollout') ?? false; if (!seen) await Bun.sleep(20); } while (!seen && Date.now() < refreshedBy);
      // A pending rollout previously held the shared queue batch and prevented every later manual refresh.
      expect(seen).toBe(true);
    } finally { resume.resolve(); await lifecycle.stop(); }
  }, 10000);
  test('cancelled collection preserves the last complete snapshot and the next attempt remains usable', async () => {
    const f = await setup(); await f.k8s.create(object('ConfigMap', 'retained')); const previous = await f.module.collect();
    const cancel = new AbortController(), list = f.k8s.listPage;
    f.k8s.listPage = async (...args) => { cancel.abort(new Error('collector lease moved')); return list(...args); };
    await expect(f.module.collect(cancel.signal)).rejects.toThrow('collector lease moved');
    expect((await f.repository.latest())?.id).toBe(previous.id);
    f.k8s.listPage = list;
    const refreshed = await f.module.collect(); expect(refreshed.id).not.toBe(previous.id); expect(refreshed.resources[0]?.name).toBe('retained');
  });
  test('status heartbeat does not invalidate confirmation; expired confirmations and changed configuration do', async () => {
    const f = await setup(), obj = await f.k8s.create(object('ConfigMap', 'config'));
    const i = await f.inspect('config'); await f.k8s.mergePatch(Resources.ConfigMap!, 'config', 'cs-demo', { metadata: { annotations: { observed: 'heartbeat' } } });
    const op = await f.module.api.accept(admin, { inspectionId: i.inspectionId, idempotencyKey: crypto.randomUUID(), params: i.request }); expect(op.phase).toBe('queued');
    const next = await f.inspect('config'); f.state.now += 300_001;
    await expect(f.module.api.accept(admin, { inspectionId: next.inspectionId, idempotencyKey: crypto.randomUUID(), params: next.request })).rejects.toThrow('过期');
    const changed = await f.inspect('config'); await f.k8s.apply({ ...obj, data: { setting: 'changed' } });
    await expect(f.module.api.accept(admin, { inspectionId: changed.inspectionId, idempotencyKey: crypto.randomUUID(), params: changed.request })).rejects.toThrow('配置已变化');
    await f.module.runOnce(); expect((await f.module.api.operation(admin, op.operationId)).phase).toBe('failed'); expect(await f.k8s.get(Resources.ConfigMap!, 'config', 'cs-demo')).toBeDefined();
  });
  test('lost mutation response resumes from marker without a second restart; timeout recheck is one durable request', async () => {
    const f = await setup(); await f.k8s.create({ ...object('Deployment', 'cs-api', 'crewstation-system', { replicas: 1, template: { metadata: {}, spec: { containers: [{ name: 'api', image: 'api' }] } } }), status: { readyReplicas: 1, replicas: 1, updatedReplicas: 1, observedGeneration: 1 } });
    const patch = f.k8s.jsonPatch; let writes = 0;
    f.k8s.jsonPatch = async (...args) => { const result = await patch(...args); writes++; await f.k8s.mergePatch(Resources.Deployment!, 'cs-api', 'crewstation-system', { metadata: { generation: 2 } }); if (writes === 1) throw new Error('connection lost after write'); return result as never; };
    const op = await f.accept('cs-api', 'restart'); await f.module.runOnce();
    expect((await f.module.api.operation(admin, op.operationId))).toMatchObject({ phase: 'needs-attention', resumePhase: 'executing', httpStatus: 503 });
    const [one, two] = await Promise.all([f.module.api.reconcile(admin, op.operationId), f.module.api.reconcile(admin, op.operationId)]); expect(one.resumeCount).toBe(1); expect(two.resumeCount).toBe(1);
    await f.module.runOnce(); expect(writes).toBe(1); expect((await f.module.api.operation(admin, op.operationId))).toMatchObject({ phase: 'needs-attention', resumePhase: 'observing', httpStatus: 504 });
    await f.k8s.mergePatch(Resources.Deployment!, 'cs-api', 'crewstation-system', { status: { observedGeneration: 2, updatedReplicas: 1 } });
    await f.module.api.reconcile(admin, op.operationId); await f.module.runOnce();
    const finished = await f.module.api.operation(admin, op.operationId); expect(finished).toMatchObject({ phase: 'succeeded', httpStatus: 200, resumeCount: 2 }); expect(writes).toBe(1);
    expect(await f.repository.update({ ...finished, phase: 'failed' }, 1)).toBe(false); expect((await f.module.api.operation(admin, op.operationId)).phase).toBe('succeeded');
  });
  test('finalizer wait remains visible and recheck watches original UID only', async () => {
    const f = await setup(); const item = await f.k8s.create(object('ConfigMap', 'blocked'));
    const del = f.k8s.delete; f.k8s.delete = async (_ref, name, namespace) => { await f.k8s.mergePatch(Resources.ConfigMap!, name, namespace, { metadata: { deletionTimestamp: new Date(f.state.now).toISOString() } }); return true; };
    const op = await f.accept('blocked'); await f.module.runOnce(); expect((await f.module.api.operation(admin, op.operationId)).reason).toContain('finalizer');
    await del(Resources.ConfigMap!, 'blocked', 'cs-demo'); await f.k8s.create({ ...item, metadata: { ...item.metadata, uid: 'new-instance' } });
    await f.module.api.reconcile(admin, op.operationId); await f.module.runOnce();
    expect((await f.module.api.operation(admin, op.operationId)).phase).toBe('succeeded'); expect((await f.k8s.get(Resources.ConfigMap!, 'blocked', 'cs-demo'))?.metadata.uid).toBe('new-instance');
  });
  test('failed inventory sources preserve last count, block writes and return explicit expiry HTTP 410', async () => {
    const f = await setup(); await f.k8s.create(object('Pod', 'project-pod')); await f.module.collect();
    const list = f.k8s.listPage; f.k8s.listPage = async (...args) => { if (args[0].kind === 'Pod') throw new PlatformError('unavailable', '503 source down'); return list(...args); };
    const snapshot = await f.module.collect(), summary = await f.module.api.summary(admin, query);
    expect(summary).toMatchObject({ complete: false, pods: 1 }); expect(summary.sources.some((s) => s.state === 'stale')).toBe(true);
    expect(snapshot.resources[0]?.availableActions.every((a) => !a.enabled)).toBe(true);
    f.state.metadataError = true; expect((await f.module.collect()).facts.complete).toBe(false);
    f.state.now += 600_001;
    const app = createApp({ name: 'cluster-test' }); for (const route of f.module.http) app.route('/', route);
    const response = await app.request(`/v1/admin/cluster/resources?snapshotId=${snapshot.id}`, { headers: { [IDENTITY_HEADERS.userId]: admin.userId } });
    expect(response.status).toBe(410); expect((await response.json()).message).toContain('过期');
    expect((await app.request('/v1/admin/cluster/summary', { headers: { [IDENTITY_HEADERS.userId]: 'not-admin' } })).status).toBe(403);
  });
});
