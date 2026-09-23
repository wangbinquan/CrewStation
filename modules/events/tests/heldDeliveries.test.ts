import { describe, expect, test } from 'bun:test';
import type { EventDelivery, ProjectId, ReleaseId, ServiceId, UserId } from '@crewstation/contracts';
import { BUILTIN_RESOURCES, ManifestSchema } from '@crewstation/contracts';
import { systemClock } from '@crewstation/kernel';
import { queueMigrations } from '@crewstation/queue';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { drizzleUnitOfWork } from '../adapters/persistence/drizzleUnitOfWork';
import { deliverEventUseCase } from '../application/deliverEvent';
import { produceEventUseCase } from '../application/produceEvent';
import { registerReleaseUseCase } from '../application/registerRelease';
import { releaseHeldUseCase } from '../application/releaseHeld';
import { eventsMigrations } from '../wiring';
import { createDeliveryWorker } from '../workers/deliveryWorker';

const available = await testDatabaseAvailable();

describe.skipIf(!available)('RFC-021 维护期间的事件暂存与补发', () => {
  test('事件开关打开：投递暂存、不开始尝试、不推送；放开后按接收顺序重新入队，投递时第一次尝试', async () => {
    const tdb = await createTestDatabase([queueMigrations, eventsMigrations]);
    try {
      const projectId = Bun.randomUUIDv7() as ProjectId, serviceId = Bun.randomUUIDv7() as ServiceId;
      const holds = new Set<ServiceId>();
      const received: EventDelivery[] = [];
      const deps = {
        uow: drizzleUnitOfWork(tdb.db, { jobMaxAttempts: 5 }), clock: systemClock, settings: { maxAttempts: 3, pushTimeoutMs: 1000 },
        services: { resolveService: async () => ({ projectId, serviceId, slug: 'source', identity: 'source/app' }) },
        projects: { authorize: async () => 'owner' as const, isAdmin: async (_id: UserId) => true }, endpoints: { resolve: async () => ({ baseUrl: 'http://receiver' }) },
        pusher: { push: async (_url: string, envelope: unknown) => { received.push(envelope as EventDelivery); return { ok: true, status: 200 }; } },
        hold: { holds: async (id: ServiceId) => holds.has(id) },
      };
      const register = registerReleaseUseCase(deps), service = { command: ['app'], port: 3000, servicePlanId: BUILTIN_RESOURCES.servicePlanSmall };
      const publish = (kind: string, spec: object) => register({ projectId, serviceId, releaseId: Bun.randomUUIDv7() as ReleaseId, occurredAt: new Date().toISOString(), tag: 'v1.0.0', commitSha: 'a'.repeat(40), manifest: ManifestSchema.parse({ apiVersion: 'crewstation/v2', kind, spec: { service, ...spec } }) });
      await publish('EventProducer', { producer: 'source', ingress: { path: '/events' }, produces: [{ eventType: 'source.updated' }] });
      const type = (await deps.uow.read.eventTypes.list())[0]!;
      await publish('DigitalWorker', { subscriptions: [{ eventTypeId: type.id, handlerPath: '/handle' }] });
      const caller = { identity: 'source/app', project: 'source', service: 'app' };
      const deliver = deliverEventUseCase(deps), release = releaseHeldUseCase(deps);

      holds.add(serviceId);
      const produced: string[] = [];
      for (const n of [1, 2, 3]) {
        produced.push((await produceEventUseCase(deps)(caller, { eventTypeId: type.id, dedupKey: String(n), occurredAt: new Date().toISOString(), payload: { n } })).eventId);
        await Bun.sleep(5);
      }
      const deliveries = (await deps.uow.read.deliveries.listByProject(projectId, undefined, 10)).reverse();
      expect(deliveries.map((d) => d.eventId) as unknown).toEqual(produced);
      // 真实的投递 worker 认领入队的任务：看到暂存就正常完成任务，不抛错、不重排。
      const worker = createDeliveryWorker({ db: tdb.db, deliver, owner: 'held-test', concurrency: 1 });
      const drain = async () => { await Bun.sleep(20); let n = 0; while ((await worker.runOnce()) > 0) n += 1; return n; };
      expect(await drain()).toBe(3);
      // 旧的队列任务再跑一次也只是看到暂存，不推送、不加尝试。
      expect(await deliver(deliveries[0]!.id)).toEqual({ state: 'held' });
      expect(received).toHaveLength(0);
      const held = await deps.uow.read.deliveries.listHeld(serviceId, 10);
      expect(held.map((d) => [d.eventId, d.state, d.attempts]) as unknown).toEqual(produced.map((id) => [id, 'held', 0]));
      expect(await release()).toBe(0);

      holds.delete(serviceId);
      expect(await release(serviceId)).toBe(3);
      expect(await deps.uow.read.deliveries.listHeld(serviceId, 10)).toHaveLength(0);
      const jobs = (await tdb.db.execute(sql`SELECT payload->>'deliveryId' AS id FROM platform_infra.jobs WHERE kind = 'events.deliver' AND state = 'pending' ORDER BY run_at, id`) as unknown as Array<{ id: string }>).map((r) => r.id);
      expect(jobs).toEqual(deliveries.map((d) => d.id));
      expect(await drain()).toBe(3);
      expect(received.map((e) => [e.eventId, e.attempt]) as unknown).toEqual(produced.map((id) => [id, 1]));
      expect((await deps.uow.read.deliveries.listByProject(projectId, 'delivered', 10)).length).toBe(3);
      expect(await release(serviceId)).toBe(0);
    } finally { await tdb.drop(); }
  });

  test('补发只处理当前不再暂存的服务：另一个服务仍在维护时它的投递继续暂存', async () => {
    const tdb = await createTestDatabase([queueMigrations, eventsMigrations]);
    try {
      const projectId = Bun.randomUUIDv7() as ProjectId, serviceId = Bun.randomUUIDv7() as ServiceId;
      const deps = {
        uow: drizzleUnitOfWork(tdb.db, { jobMaxAttempts: 5 }), clock: systemClock, settings: { maxAttempts: 3, pushTimeoutMs: 1000 },
        services: { resolveService: async () => ({ projectId, serviceId, slug: 'source', identity: 'source/app' }) },
        projects: { authorize: async () => 'owner' as const, isAdmin: async (_id: UserId) => true }, endpoints: { resolve: async () => ({ baseUrl: 'http://receiver' }) },
        pusher: { push: async () => ({ ok: true, status: 200 }) },
        hold: { holds: async () => true },
      };
      const register = registerReleaseUseCase(deps), service = { command: ['app'], port: 3000, servicePlanId: BUILTIN_RESOURCES.servicePlanSmall };
      const publish = (kind: string, spec: object) => register({ projectId, serviceId, releaseId: Bun.randomUUIDv7() as ReleaseId, occurredAt: new Date().toISOString(), tag: 'v1.0.0', commitSha: 'a'.repeat(40), manifest: ManifestSchema.parse({ apiVersion: 'crewstation/v2', kind, spec: { service, ...spec } }) });
      await publish('EventProducer', { producer: 'source', ingress: { path: '/events' }, produces: [{ eventType: 'source.updated' }] });
      const type = (await deps.uow.read.eventTypes.list())[0]!;
      await publish('DigitalWorker', { subscriptions: [{ eventTypeId: type.id, handlerPath: '/handle' }] });
      await produceEventUseCase(deps)({ identity: 'source/app', project: 'source', service: 'app' }, { eventTypeId: type.id, dedupKey: '1', occurredAt: new Date().toISOString(), payload: {} });
      const delivery = (await deps.uow.read.deliveries.listByProject(projectId, undefined, 1))[0]!;
      expect(await deliverEventUseCase(deps)(delivery.id)).toEqual({ state: 'held' });
      expect(await releaseHeldUseCase(deps)()).toBe(0);
      expect((await deps.uow.read.deliveries.getById(delivery.id))?.state).toBe('held');
    } finally { await tdb.drop(); }
  });
});
