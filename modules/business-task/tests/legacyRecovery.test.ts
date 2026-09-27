import { afterEach, describe, expect, test } from 'bun:test';
import type { Actor, TaskId, TraceId, UserId } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { businessTaskMigrations } from '../wiring';
import { drizzleLegacyMutations, legacyMutationsQuiescent } from '../adapters/persistence/legacyMutations';
import { legacyRecoveryUseCases } from '../application/legacyRecovery';
import { executionHttpFixture } from './executionHttpFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-027 legacy recovery consumes immutable process stop evidence', () => {
  let db: TestDatabase;
  afterEach(async () => { await db?.drop(); });
  const fixture = async () => {
    db = await createTestDatabase([businessTaskMigrations]); const f = await executionHttpFixture(db.db);
    const ownerPodUid = newResourceId(), barrier = drizzleLegacyMutations(db.db, ownerPodUid), state = { ownerGone: false, failObservation: false, released: false };
    const taskId = newResourceId() as TaskId;
    const env = { id: taskId, projectId: f.projectId, state: 'running' as const, connected: true, profile: f.taskProfileId, traceId: 'a'.repeat(32), podName: 'legacy-pod' };
    f.environments.set(taskId, env);
    f.environmentPort.releaseEnvironment = async (id) => { const target = f.environments.get(id)!; target.state = state.released ? 'released' : 'releasing'; return target; };
    const recovery = legacyRecoveryUseCases({ environments: f.environmentPort, directory: { resolveServiceIdentity: async (identity) => identity === 'demo/demo' ? { serviceId: f.serviceId, projectId: f.projectId } : undefined } }, barrier,
      { ownerGone: async (uid) => { expect(uid).toBe(ownerPodUid); if (state.failObservation) throw new Error('K8s unavailable'); return state.ownerGone; } });
    const actor: Actor = { userId: newResourceId() as UserId, isAdmin: true };
    return { ...f, barrier, state, taskId, actor, recovery, ownerPodUid };
  };
  test('unknown remote effect is retained until explicit runtime stop is observed; no TTL or missing record shortcut', async () => {
    const f = await fixture(), ticket = await f.barrier.begin({ serviceId: f.serviceId, taskId: f.taskId, kind: 'runner:exec' });
    await f.barrier.settle(ticket, 'unknown');
    const call = (action: 'inspect' | 'reconcile' | 'stop') => f.recovery.legacyRecovery(f.actor, 'demo/demo', action, ticket.id);
    expect((await call('inspect')).items[0]).toMatchObject({ canStopRuntime: true, blockedBy: ['runtime_stop_unconfirmed'] });
    expect((await call('reconcile')).recovered).toBe(0);
    await expect(f.recovery.legacyRecovery({ ...f.actor, isAdmin: false }, 'demo/demo', 'stop', ticket.id)).rejects.toMatchObject({ kind: 'forbidden' });
    expect((await call('stop')).recovered).toBe(0);
    f.state.released = true;
    expect((await call('stop')).recovered).toBe(1);
    expect(await call('reconcile')).toEqual({ recovered: 0, items: [] });
    expect(await legacyMutationsQuiescent(db.db, f.serviceId)).toBe(true);
    const missing = await f.barrier.begin({ serviceId: f.serviceId, kind: 'create-environment', taskId: newResourceId() }); await f.barrier.settle(missing, 'unknown');
    expect((await call('reconcile')).items[0]?.canStopRuntime).toBe(false);
    expect(await legacyMutationsQuiescent(db.db, f.serviceId)).toBe(false);
    f.environmentPort.blockBusinessAdmission = async (serviceId, id) => { expect(serviceId).toBe(f.serviceId); expect(id).toBe(missing.taskId as TaskId); return true; };
    expect((await f.recovery.legacyRecovery(f.actor, 'demo/demo', 'stop', missing.id)).recovered).toBe(1);
    expect(await legacyMutationsQuiescent(db.db, f.serviceId)).toBe(true);
  });
  test('crashed request requires original controller UID gone and every child effect reconciled; first claim remains blocked', async () => {
    const f = await fixture(), parent = await f.barrier.begin({ serviceId: f.serviceId, kind: 'create-task-request' });
    const child = await f.barrier.begin({ serviceId: f.serviceId, taskId: f.taskId, kind: 'create-environment', parentId: parent.id });
    await f.barrier.settle(child, 'unknown');
    const reconcile = () => f.recovery.legacyRecovery(f.actor, 'demo/demo', 'reconcile');
    expect((await reconcile()).items.find((i) => i.id === parent.id)?.blockedBy).toEqual(['owner_process_not_stopped', 'child_effects_unconfirmed']);
    f.state.failObservation = true; await expect(reconcile()).rejects.toThrow('K8s unavailable'); f.state.failObservation = false;
    f.state.ownerGone = true;
    expect((await reconcile()).recovered).toBe(0);
    expect((await f.request('/v3/business-execution/control/claim', { instanceId: newResourceId() })).status).toBe(412);
    f.state.released = true; await f.recovery.legacyRecovery(f.actor, 'demo/demo', 'stop', child.id);
    expect((await reconcile()).items).toHaveLength(0);
    expect((await f.request('/v3/business-execution/control/claim', { instanceId: newResourceId() })).status).toBe(200);
  });
  test('recovered request cannot commit a late new task; absent owner identity never clears an open request', async () => {
    const f = await fixture(), ticket = await f.barrier.begin({ serviceId: f.serviceId, kind: 'create-task-request' });
    f.state.ownerGone = true;
    expect((await f.recovery.legacyRecovery(f.actor, 'demo/demo', 'reconcile')).recovered).toBe(1);
    await expect(f.barrier.local(ticket, (scope) => scope.tasks.insert({ id: f.taskId, serviceId: f.serviceId, projectId: f.projectId, callerIdentity: 'demo/demo', state: 'creating', traceId: 'a'.repeat(32) as TraceId, volumeMode: 'persistent', profile: f.taskProfileId, labels: {}, createdAt: new Date(), updatedAt: new Date() }))).rejects.toMatchObject({ kind: 'precondition' });
    const old = drizzleLegacyMutations(db.db); await old.begin({ serviceId: f.serviceId, kind: 'create-task-request' });
    expect((await f.recovery.legacyRecovery(f.actor, 'demo/demo', 'reconcile')).items[0]?.blockedBy).toEqual(['owner_identity_missing']);
  });
  test('every unresolved remote effect remains blocked in a multi-ticket diagnostic response', async () => {
    const f = await fixture();
    for (let i = 0; i < 3; i++) { const ticket = await f.barrier.begin({ serviceId: f.serviceId, taskId: f.taskId, kind: 'runner:exec' }); await f.barrier.settle(ticket, 'unknown'); }
    const diagnostic = await f.recovery.legacyRecovery(f.actor, 'demo/demo', 'inspect');
    expect(diagnostic.items).toHaveLength(3);
    expect(diagnostic.items.every((item) => item.blockedBy.includes('runtime_stop_unconfirmed'))).toBe(true);
  });

});
