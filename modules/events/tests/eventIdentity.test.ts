import { describe, expect, test } from 'bun:test';
import type { ProjectId, ReleaseId, ServiceId, UserId } from '@crewstation/contracts';
import { BUILTIN_RESOURCES, ManifestSchema, ResourceIdSchema } from '@crewstation/contracts';
import { systemClock } from '@crewstation/kernel';
import { queueMigrations } from '@crewstation/queue';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { drizzleUnitOfWork } from '../adapters/persistence/drizzleUnitOfWork';
import { registerReleaseUseCase } from '../application/registerRelease';
import { produceEventUseCase, produceLegacyEventUseCase } from '../application/produceEvent';
import { deliverEventUseCase } from '../application/deliverEvent';
import { eventsMigrations } from '../wiring';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('event resource identities', () => {
  test('UUID subscriptions and explicit legacy protocol input deduplicate and deliver the same identities', async () => {
    const tdb = await createTestDatabase([queueMigrations, eventsMigrations]);
    try {
      const projectId = Bun.randomUUIDv7() as ProjectId, serviceId = Bun.randomUUIDv7() as ServiceId;
      const received: unknown[] = [];
      const deps = { uow: drizzleUnitOfWork(tdb.db, { jobMaxAttempts: 5 }), clock: systemClock,
        services: { resolveService: async () => ({ projectId, serviceId, slug: 'source', identity: 'source/app' }) },
        projects: { authorize: async () => "owner" as const, isAdmin: async (_id: UserId) => true }, endpoints: { resolve: async () => ({ baseUrl: 'http://receiver' }) },
        pusher: { push: async (_url: string, envelope: unknown) => { received.push(envelope); return { ok: true, status: 200 }; } }, settings: { maxAttempts: 3, pushTimeoutMs: 1000 }, hold: { holds: async () => false } };
      const register = registerReleaseUseCase(deps), service = { command: ['app'], port: 3000, servicePlanId: BUILTIN_RESOURCES.servicePlanSmall };
      const publish = (kind: string, spec: object) => register({ projectId, serviceId, releaseId: Bun.randomUUIDv7() as ReleaseId, occurredAt: new Date().toISOString(), tag: 'v1.0.0', commitSha: 'a'.repeat(40), manifest: ManifestSchema.parse({ apiVersion: 'crewstation/v2', kind, spec: { service, ...spec } }) });
      const producer = { producer: 'source', ingress: { path: '/events' }, produces: [{ eventType: 'source.updated' }] };
      await publish('EventProducer', producer);
      const type = (await deps.uow.read.eventTypes.list())[0]!;
      expect(ResourceIdSchema.safeParse(type.id).success).toBe(true);
      expect(ResourceIdSchema.safeParse(type.producerId).success).toBe(true);
      await publish('EventProducer', producer);
      expect((await deps.uow.read.eventTypes.list())[0]!.id).toBe(type.id);
      await publish('DigitalWorker', { subscriptions: [{ eventTypeId: type.id, handlerPath: '/handle' }] });
      const caller = { identity: 'source/app', project: 'source', service: 'app' }, input = { eventTypeId: type.id, dedupKey: '1', occurredAt: new Date().toISOString(), payload: { eventType: 'source.updated', unchanged: true } };
      const result = await produceEventUseCase(deps)(caller, input);
      expect(result.deliveries).toBe(1);
      const duplicate = await produceLegacyEventUseCase(deps)(caller, { ...input, eventType: 'source.updated' });
      expect(duplicate).toMatchObject({ eventId: result.eventId, deduplicated: true, deliveries: 0 });
      const delivery = (await deps.uow.read.deliveries.listByProject(projectId, undefined, 10))[0]!;
      expect(delivery.eventTypeId).toBe(type.id);
      await deliverEventUseCase(deps)(delivery.id);
      expect(received[0]).toMatchObject({ eventId: result.eventId, eventTypeId: type.id, eventType: 'source.updated', source: { producerId: type.producerId }, payload: input.payload });
      await expect(produceEventUseCase(deps)(caller, { ...input, eventTypeId: 'source.updated' })).rejects.toMatchObject({ kind: 'not_found' });
      await deps.uow.run((scope) => scope.eventTypes.replaceForProducer(type.producerId, []));
      await expect(produceEventUseCase(deps)(caller, { ...input, dedupKey: '2' })).rejects.toMatchObject({ kind: 'not_found' });
      await publish('EventProducer', producer);
      expect((await deps.uow.read.eventTypes.list())[0]!.id).toBe(type.id);
    } finally { await tdb.drop(); }
  });
});
