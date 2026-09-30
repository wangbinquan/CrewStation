import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Actor, ProjectId, ServiceId, TaskId, UserId } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { generateSecretKey } from '@crewstation/secretbox';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { createDataModule, dataMigrations } from '../wiring';

const available = await testDatabaseAvailable(); let db: TestDatabase;
beforeAll(async () => { if (available) db = await createTestDatabase([eventbusMigrations, dataMigrations]); }); afterAll(async () => { await db?.drop(); });
function fixture() {
  const projectId = Bun.randomUUIDv7() as ProjectId, serviceId = Bun.randomUUIDv7() as ServiceId, taskId = Bun.randomUUIDv7() as TaskId;
  const owner: Actor = { userId: Bun.randomUUIDv7() as UserId, isAdmin: false }, admin: Actor = { userId: Bun.randomUUIDv7() as UserId, isAdmin: true }, developer: Actor = { userId: Bun.randomUUIDv7() as UserId, isAdmin: false };
  const state = { running: true, fail: false, writes: 0, now: Date.now(), drops: 0 };
  const mod = createDataModule({ db: db.db, clock: { now: () => new Date(state.now) }, authorizer: { authorize: async (actor, project, action) => { if (project !== projectId) throw new Error('wrong project'); if (action === 'approve-data-access' && actor.userId !== admin.userId) throw new Error('forbidden'); return actor.userId === owner.userId ? 'owner' : actor.userId === admin.userId ? 'admin' : 'developer'; } }, isAdmin: async (id) => id === admin.userId, services: { resolveServiceById: async (id) => id === serviceId ? { projectId, slug: `resource-${projectId.slice(-8)}` } : undefined }, productionTasks: { get: async (id) => id === taskId ? { taskId, serviceId, projectId, kind: 'dev-session', state: state.running ? 'running' : 'paused', podUid: 'fixed-pod' } : undefined, list: async () => [taskId] }, provider: { provisionDatabase: async ({ databaseName }) => ({ dsn: `postgres://role:secret@host/${databaseName}` }), createTemporaryRole: async () => { if (state.fail) throw new Error('role plane unavailable'); state.writes++; return { dsn: 'postgres://role:secret@host/database' }; }, dropDatabase: async () => {}, dropRole: async () => { state.drops++; } }, settings: { defaultPlan: 'shared', secretKeyBase64: generateSecretKey(), postgres: { adminUrl: 'postgres://unused', visibleHost: 'host', visiblePort: 5432 } } });
  return { mod, state, projectId, serviceId, taskId, owner, admin, developer };
}
describe.skipIf(!available)('production access resource commands with durable binding identity', () => {
  test('owner requests, administrator grants once, developer cannot submit or forge a direct administrator', async () => {
    const f = fixture(); await f.mod.api.ensureServiceData(f.serviceId); const view = await f.mod.api.inspectProductionAccess(f.owner, f.projectId, f.taskId);
    expect(view).toMatchObject({ explicitlyRequestable: true, available: true, owned: false }); expect(JSON.stringify(view)).not.toContain('postgres://');
    const input = { operationId: Bun.randomUUIDv7(), taskId: f.taskId, expectedRevision: view.revision, values: { mode: 'diagnostic-readonly', ttlMinutes: 30 }, requestedBy: f.owner.userId, reason: 'Inspect production orders' };
    await expect(f.mod.api.requestTaskBinding(f.developer, { taskId: f.taskId, serviceId: f.serviceId }, { mode: 'diagnostic-readonly', ttlMinutes: 30 })).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(f.mod.api.applyProductionAccess({ ...f.owner, isAdmin: true }, f.projectId, input)).rejects.toMatchObject({ kind: 'forbidden' });
    const receipt = await f.mod.api.applyProductionAccess(f.admin, f.projectId, input); expect(receipt.applied).toBe(true); expect(await f.mod.api.applyProductionAccess(f.admin, f.projectId, input)).toEqual(receipt); expect(f.state.writes).toBe(1);
    expect(await f.mod.api.productionAccessReceipt(f.projectId, input.operationId)).toEqual(receipt); expect((await f.mod.api.observeProductionAccess(f.projectId, input.operationId)).applied).toBe(true);
    await expect(f.mod.api.applyProductionAccess(f.admin, f.projectId, { ...input, values: { ...input.values, ttlMinutes: 60 } })).rejects.toMatchObject({ kind: 'conflict' });
    await expect(f.mod.api.revokeTaskBinding(f.owner, input.operationId)).rejects.toThrow('forbidden'); expect(await f.mod.api.revokeTaskBinding(f.admin, input.operationId, { decision: 'Production access complete' })).toMatchObject({ state: 'revoked', decidedBy: f.admin.userId, decision: 'Production access complete' }); expect(f.state.drops).toBe(1);
    await expect(f.mod.api.observeProductionAccess(f.projectId, input.operationId)).rejects.toMatchObject({ kind: 'precondition' });
  });
  test('failed external role provisioning keeps the approved binding; retry uses the same operation without another request', async () => {
    const f = fixture(); await f.mod.api.ensureServiceData(f.serviceId); const view = await f.mod.api.inspectProductionAccess(f.owner, f.projectId, f.taskId), operationId = Bun.randomUUIDv7();
    const input = { operationId, taskId: f.taskId, expectedRevision: view.revision, values: { mode: 'production-change', ttlMinutes: 5 }, requestedBy: f.owner.userId, reason: 'Correct production data' };
    f.state.fail = true; await expect(f.mod.api.applyProductionAccess(f.admin, f.projectId, input)).rejects.toThrow('role plane unavailable'); expect((await f.mod.api.listProjectBindings(f.admin, f.projectId))[0]?.state).toBe('approved'); expect(await f.mod.api.productionAccessReceipt(f.projectId, operationId)).toBeUndefined();
    f.state.fail = false; expect((await f.mod.api.applyProductionAccess(f.admin, f.projectId, input)).applied).toBe(true); expect(f.state.writes).toBe(1); f.state.now += 6 * 60000;
    await expect(f.mod.api.observeProductionAccess(f.projectId, operationId)).rejects.toMatchObject({ kind: 'precondition' });
  });
  test('target scope, workload state, revision and legacy pending requests are rechecked', async () => {
    const f = fixture(); await f.mod.api.ensureServiceData(f.serviceId); f.state.running = false; expect((await f.mod.api.listProductionAccessTargets(f.owner, f.projectId))[0]?.available).toBe(false); f.state.running = true;
    await expect(f.mod.api.inspectProductionAccess(f.owner, f.projectId, Bun.randomUUIDv7() as TaskId)).rejects.toMatchObject({ kind: 'not_found' }); const view = await f.mod.api.inspectProductionAccess(f.owner, f.projectId, f.taskId);
    const input = { operationId: Bun.randomUUIDv7(), taskId: f.taskId, expectedRevision: 'obsolete', values: { mode: 'diagnostic-readonly', ttlMinutes: 30 }, requestedBy: f.owner.userId, reason: 'Review data' };
    await expect(f.mod.api.applyProductionAccess(f.admin, f.projectId, input)).rejects.toMatchObject({ kind: 'conflict' }); await expect(f.mod.api.applyProductionAccess(f.admin, f.projectId, { ...input, expectedRevision: view.revision, values: { mode: 'development', ttlMinutes: 30 } })).rejects.toMatchObject({ kind: 'precondition' });
    await f.mod.api.requestTaskBinding(f.owner, { taskId: f.taskId, serviceId: f.serviceId }, { mode: 'production-change', ttlMinutes: 30 }); expect((await f.mod.api.inspectProductionAccess(f.owner, f.projectId, f.taskId)).available).toBe(false); expect(f.state.writes).toBe(0);
  });
});
