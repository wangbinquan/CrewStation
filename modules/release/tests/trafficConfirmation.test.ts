import { expect, test } from 'bun:test';
import type { Actor, MigrationSpec, ProjectId, ReleaseId, ServiceId, UserId } from '@crewstation/contracts';
import { ManifestSchema } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { fixedClock } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { drizzleUnitOfWork } from '../adapters/persistence/drizzleUnitOfWork';
import { switchTrafficUseCase } from '../application/switchTraffic';
import { initialSlots } from '../domain/slots';
import type { UnitOfWork } from '../ports/unitOfWork';
import { releaseMigrations } from '../wiring';

const available = await testDatabaseAvailable(), now = new Date('2026-09-13T01:00:00Z');
const serviceId = '01a0bf5d-8f4b-7455-8963-87369647717e' as ServiceId, projectId = '01a0bf5d-8f4b-7aef-84b8-c458233bab22' as ProjectId, releaseId = '01a0bf5d-8f4b-778f-8c4c-27f518d5c2e2' as ReleaseId;
const actor: Actor = { userId: '01a0bf5d-8f4b-7baf-8eed-680262285455' as UserId, isAdmin: false };
function signal() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }

test.skipIf(!available)('两个首次上线请求读取同一服务时串行核对；只落一次切换和事件，普通查询仍可读', async () => {
  const db = await createTestDatabase([eventbusMigrations, releaseMigrations]), uow = drizzleUnitOfWork(db.db);
  const firstRead = signal(), firstMayProceed = signal(), secondStarted = signal(); let reads = 0, secondSettled = false;
  const pending: Array<Promise<unknown>> = [];
  try {
    await uow.run(async (scope) => {
      const initial = initialSlots(serviceId, now);
      await scope.slots.save({ ...initial, green: { ...initial.green, releaseId, state: 'ready', replicas: 1, readyReplicas: 1 } });
      await scope.releases.insert({ id: releaseId, serviceId, projectId, tag: 'v0.1.0', commitSha: 'a'.repeat(40), branch: 'main', status: 'ready', targetSlot: 'green', pipeline: { step: 4 }, createdBy: actor.userId, createdAt: now, updatedAt: now });
    });
    const observed: UnitOfWork = { read: uow.read, run: (action) => uow.run((scope) => action({ ...scope, slots: { ...scope.slots, get: async (id) => {
      const order = ++reads; if (order === 2) secondStarted.resolve();
      const slots = await scope.slots.get(id);
      if (order === 1) { firstRead.resolve(); await firstMayProceed.promise; }
      return slots;
    } } })) };
    const switchTraffic = switchTrafficUseCase({ uow: observed, authorizer: { authorize: async () => {} }, services: { resolveServiceById: async () => ({ projectId, slug: 'demo', name: 'demo', namespace: 'cs-demo' }) }, maintenance: { open: async () => false }, clock: fixedClock(now.toISOString()) });
    const input = { toSlot: 'preview' as const, expectedActiveRelease: null, expectedTargetRelease: releaseId };
    pending.push(switchTraffic(actor, serviceId, input)); await firstRead.promise;
    pending.push(switchTraffic(actor, serviceId, input).finally(() => { secondSettled = true; })); await secondStarted.promise;
    // 直接观察 PostgreSQL 的锁等待；原查询不锁行，第二次请求会越过确认并提交。
    let blocked = false; const deadline = Date.now() + 10_000;
    while (!blocked && !secondSettled && Date.now() < deadline) {
      const rows = await db.handle.client`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event_type = 'Lock' AND query LIKE '%service_slots%') AS blocked`;
      blocked = Boolean(rows[0]?.blocked); if (!blocked && !secondSettled) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(blocked).toBe(true); expect(secondSettled).toBe(false);
    expect((await uow.read.slots.get(serviceId))?.active).toBe('blue');
    firstMayProceed.resolve(); const results = await Promise.allSettled(pending);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: { kind: 'precondition' } });
    expect(await uow.read.switches.listByService(serviceId, 10)).toHaveLength(1);
    const events = await db.handle.client`SELECT topic FROM platform_infra.domain_events WHERE topic = 'release.traffic-switched'`;
    expect(events).toHaveLength(1);
  } finally { firstMayProceed.resolve(); await Promise.allSettled(pending); await db.drop(); }
}, 20_000);

test.skipIf(!available)('旧待命版本仍就绪时，进行中的发布阻止切流；发布失败后可重新确认原版本', async () => {
  const db = await createTestDatabase([eventbusMigrations, releaseMigrations]), uow = drizzleUnitOfWork(db.db);
  const pendingId = '01a0bf5d-8f4b-7dda-8ca7-d5d5f8a92b44' as ReleaseId;
  try {
    await uow.run(async (scope) => {
      const initial = initialSlots(serviceId, now);
      await scope.slots.save({ ...initial, green: { ...initial.green, releaseId, state: 'ready', replicas: 1, readyReplicas: 1 } });
      const base = { serviceId, projectId, commitSha: 'a'.repeat(40), branch: 'main', targetSlot: 'green' as const, pipeline: { step: 0 }, createdBy: actor.userId, createdAt: now, updatedAt: now };
      await scope.releases.insert({ ...base, id: releaseId, tag: 'v0.1.0', status: 'ready' });
      await scope.releases.insert({ ...base, id: pendingId, tag: 'v0.2.0', status: 'pending' });
    });
    const change = switchTrafficUseCase({ uow, authorizer: { authorize: async () => {} }, services: { resolveServiceById: async () => ({ projectId, slug: 'demo', name: 'demo', namespace: 'cs-demo' }) }, maintenance: { open: async () => false }, clock: fixedClock(now.toISOString()) });
    const input = { toSlot: 'preview' as const, expectedActiveRelease: null, expectedTargetRelease: releaseId };
    for (const status of ['pending', 'building', 'migrating', 'deploying'] as const) {
      await uow.run(async (scope) => { const release = (await scope.releases.getById(pendingId))!; await scope.releases.update({ ...release, status }); });
      await expect(change(actor, serviceId, input)).rejects.toMatchObject({ kind: 'precondition', details: { releaseId: pendingId } });
      expect((await uow.read.slots.get(serviceId))?.active).toBe('blue');
    }
    expect(await uow.read.switches.listByService(serviceId, 10)).toHaveLength(0);
    const events = await db.handle.client`SELECT topic FROM platform_infra.domain_events WHERE topic = 'release.traffic-switched'`;
    expect(events).toHaveLength(0);
    await uow.run(async (scope) => { const release = (await scope.releases.getById(pendingId))!; await scope.releases.update({ ...release, status: 'failed' }); });
    expect((await change(actor, serviceId, input)).releaseId).toBe(releaseId);
    expect(await uow.read.switches.listByService(serviceId, 10)).toHaveLength(1);
  } finally { await db.drop(); }
});

const rollbackCases: Array<{ name: string; migration: MigrationSpec; newer?: boolean; denial?: string }> = [
  { name: '配置禁止回退不冒充破坏性迁移', migration: { compatibility: 'none', destructive: false, rollback: 'blocked' }, denial: '的发布配置明确禁止回退' },
  { name: '破坏性迁移保留实际禁止原因', migration: { compatibility: 'destructive', destructive: true, rollback: 'switch-back' }, denial: '含破坏性迁移' },
  { name: '兼容版本仍可回退', migration: { compatibility: 'none', destructive: false, rollback: 'switch-back' } },
  { name: '禁止回退不阻止上线较新版本', migration: { compatibility: 'none', destructive: false, rollback: 'blocked' }, newer: true },
];
for (const scenario of rollbackCases) test.skipIf(!available)(scenario.name, async () => {
  const db = await createTestDatabase([eventbusMigrations, releaseMigrations]), uow = drizzleUnitOfWork(db.db);
  const targetId = '01a0bf5d-8f4b-7fd8-80e1-98a6fb83510b' as ReleaseId;
  try {
    const manifest = ManifestSchema.parse({ apiVersion: 'crewstation/v2', kind: 'DigitalWorker', spec: {
      service: { command: ['bun', 'run', 'src/main.ts'], port: 3000, servicePlanId: '01a0bf5d-8f4b-7000-9e4b-b54e91ee9d10' }, release: { migration: scenario.migration },
    } });
    await uow.run(async (scope) => {
      const initial = initialSlots(serviceId, now);
      await scope.slots.save({ ...initial,
        blue: { ...initial.blue, releaseId, state: 'ready', replicas: 1, readyReplicas: 1 },
        green: { ...initial.green, releaseId: targetId, state: 'ready', replicas: 1, readyReplicas: 1 },
      });
      const base = { serviceId, projectId, commitSha: 'a'.repeat(40), branch: 'main', status: 'ready' as const, pipeline: { step: 4 }, createdBy: actor.userId, updatedAt: now };
      await scope.releases.insert({ ...base, id: releaseId, tag: 'v0.2.0', targetSlot: 'blue', manifest, createdAt: new Date(now.getTime() - 10_000) });
      await scope.releases.insert({ ...base, id: targetId, tag: scenario.newer ? 'v0.3.0' : 'v0.1.0', targetSlot: 'green', createdAt: new Date(now.getTime() - (scenario.newer ? 5_000 : 20_000)) });
    });
    const change = switchTrafficUseCase({ uow, authorizer: { authorize: async () => {} }, services: { resolveServiceById: async () => ({ projectId, slug: 'demo', name: 'demo', namespace: 'cs-demo' }) }, maintenance: { open: async () => false }, clock: fixedClock(now.toISOString()) });
    const input = { toSlot: 'preview' as const, expectedActiveRelease: releaseId, expectedTargetRelease: targetId };
    if (scenario.denial) {
      // rollback: blocked 可以单独声明；拒绝时不能虚报发生了破坏性迁移，也不能落切流记录。
      await expect(change(actor, serviceId, input)).rejects.toMatchObject({ kind: 'precondition', message: `当前版本 v0.2.0 ${scenario.denial}，不能切回旧版本 v0.1.0` });
    } else expect((await change(actor, serviceId, input)).releaseId).toBe(targetId);
    expect((await uow.read.slots.get(serviceId))?.active).toBe(scenario.denial ? 'blue' : 'green');
    expect(await uow.read.switches.listByService(serviceId, 10)).toHaveLength(scenario.denial ? 0 : 1);
    const events = await db.handle.client`SELECT topic FROM platform_infra.domain_events WHERE topic = 'release.traffic-switched'`;
    expect(events).toHaveLength(scenario.denial ? 0 : 1);
  } finally { await db.drop(); }
});
