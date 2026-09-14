import { afterEach, expect, test } from 'bun:test';
import type { EventDelivery, EventId, ProjectId, ServiceId, TraceId } from '@crewstation/contracts';
import { IDENTITY_HEADERS } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { createApp } from '@crewstation/http';
import { queueMigrations } from '@crewstation/queue';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { drizzleUnitOfWork } from '../adapters/persistence/drizzleUnitOfWork';
import { newDelivery } from '../domain/delivery';
import { createEventsModule, eventsMigrations } from '../wiring';
import { createDeliveryWorker } from '../workers/deliveryWorker';

const available = await testDatabaseAvailable();
let fixture: Awaited<ReturnType<typeof setup>> | undefined;
afterEach(async () => { await fixture?.close(); fixture = undefined; });

/** 真实 HTTP 查询／重放、PostgreSQL 事务和队列；授权端口只控制两个请求到达的先后。 */
async function setup({ blockBoth = false, holdSettlement = false } = {}) {
  const db = await createTestDatabase([eventbusMigrations, queueMigrations, eventsMigrations]);
  const projectId = `prj_${'1'.repeat(32)}` as ProjectId, serviceId = `svc_${'2'.repeat(32)}` as ServiceId;
  const eventId = `evt_${'3'.repeat(32)}` as EventId, traceId = '4'.repeat(32) as TraceId, deliveryId = `dlv_${'5'.repeat(32)}`;
  const received: EventDelivery[] = []; let fail = true, writes = 0;
  const blocked = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>();
  const settling = Promise.withResolvers<void>(), settlement = Promise.withResolvers<void>();
  const subscriber = Bun.serve({ port: 0, fetch: async (req) => { received.push(await req.json() as EventDelivery); return new Response(fail ? 'failed' : 'ok', { status: fail ? 500 : 200 }); } });
  const events = createEventsModule({
    db: db.db, settings: { maxAttempts: 1 },
    projects: { isAdmin: async () => true, authorize: async (_actor, _project, action) => {
      if (action === 'manage-production-config' && ++writes <= (blockBoth ? 2 : 1)) {
        if (writes === (blockBoth ? 2 : 1)) entered.resolve();
        await blocked.promise;
      }
      return 'owner';
    } },
    services: { resolveService: async () => undefined },
    endpoints: { resolve: async () => ({ baseUrl: `http://127.0.0.1:${subscriber.port}` }) },
  });
  const uow = drizzleUnitOfWork(db.db, { jobMaxAttempts: 3 }), now = new Date();
  const event = { id: eventId, eventType: 'qa.replay', traceId, producer: 'qa', producerProject: 'qa', dedupKey: 'replay-concurrency', occurredAt: now, receivedAt: now, payload: { marker: 'replay-only-once' } };
  const subscription = { id: 'sub-replay', projectId, serviceId, eventType: event.eventType, handlerPath: '/events/qa', state: 'active' as const, updatedAt: now };
  await uow.run(async (scope) => {
    await scope.inbox.insert(event); await scope.subscriptions.upsert(subscription);
    await scope.deliveries.insert(newDelivery(deliveryId, event, subscription, now)); await scope.scheduler.schedule(deliveryId);
  });
  let initialRun: Promise<number> | undefined;
  if (holdSettlement) {
    const worker = createDeliveryWorker({ db: db.db, owner: 'initial', concurrency: 1, deliver: async (id) => {
      const result = await events.api.deliver(id); settling.resolve(); await settlement.promise; return result;
    } });
    initialRun = worker.runOnce(); await settling.promise;
  } else await events.workers[0]!.runOnce();
  fail = false;
  expect(await uow.read.deliveries.getById(deliveryId)).toMatchObject({ state: 'dead', attempts: 1, lastError: 'HTTP 500' });
  const app = createApp({ name: 'replay-test' }); for (const route of events.http.query) app.route('/', route);
  const post = () => app.request(`/v1/deliveries/${deliveryId}/replay`, { method: 'POST', headers: { [IDENTITY_HEADERS.userId]: `usr_${'6'.repeat(32)}` } });
  return { post, entered: entered.promise, release: () => blocked.resolve(), received, eventId, traceId, deliveryId, uow, worker: events.workers[0]!,
    settleInitial: async () => { settlement.resolve(); await initialRun; },
    close: async () => { blocked.resolve(); settlement.resolve(); await initialRun; subscriber.stop(true); await db.drop(); } };
}

for (const finishFirst of [false, true]) test.skipIf(!available)(`迟到的重放不覆盖先到请求的 ${finishFirst ? 'delivered' : 'pending'} 结果`, async () => {
  fixture = await setup(); const f = fixture;
  const late = f.post(); await f.entered;
  try {
    expect((await f.post()).status).toBe(200);
    if (finishFirst) expect(await f.worker.runOnce()).toBe(1);
  } finally { f.release(); }
  const response = await late; await f.worker.runOnce();
  // 旧请求在授权前已读取 dead；迟到覆盖 delivered 后会再次向实际 HTTP 订阅者投递。
  expect(f.received).toHaveLength(2);
  expect(response.status).toBe(412);
  expect(await response.json()).toMatchObject({ error: 'precondition', details: { state: finishFirst ? 'delivered' : 'pending' } });
  expect(await f.uow.read.deliveries.getById(f.deliveryId)).toMatchObject({ state: 'delivered', attempts: 1, eventId: f.eventId, traceId: f.traceId });
  expect(f.received[1]).toMatchObject({ deliveryId: f.deliveryId, eventId: f.eventId, traceId: f.traceId, attempt: 1 });
  expect(await f.worker.runOnce()).toBe(0);
});

test.skipIf(!available)('同时到达的两个死信重放只有一个被受理并入队', async () => {
  fixture = await setup({ blockBoth: true }); const f = fixture;
  const a = f.post(), b = f.post(); await f.entered; f.release();
  const responses = await Promise.all([a, b]);
  expect(responses.map((r) => r.status).sort()).toEqual([200, 412]);
  expect(await f.worker.runOnce()).toBe(1); expect(f.received).toHaveLength(2);
  expect(await f.worker.runOnce()).toBe(0);
});

test.skipIf(!available)('原投递任务仍在收尾时不虚报重新入队，收尾后可以正常重放', async () => {
  fixture = await setup({ holdSettlement: true }); const f = fixture;
  const before = await f.uow.read.deliveries.getById(f.deliveryId);
  const request = f.post(); await f.entered; f.release(); const response = await request;
  await f.settleInitial();
  // 旧任务仍为 running 时，队列去重曾吞掉新任务，HTTP 却成功并把投递永久留在 pending。
  expect({ state: (await f.uow.read.deliveries.getById(f.deliveryId))!.state, jobs: await f.worker.runOnce() }).toEqual({ state: 'dead', jobs: 0 });
  expect(await f.uow.read.deliveries.getById(f.deliveryId)).toEqual(before);
  expect(response.status).toBe(412); expect(await response.json()).toMatchObject({ error: 'precondition', details: { deliveryId: f.deliveryId } });
  expect(f.received).toHaveLength(1);
  expect((await f.post()).status).toBe(200); expect(await f.worker.runOnce()).toBe(1);
  expect(f.received).toHaveLength(2); expect(await f.uow.read.deliveries.getById(f.deliveryId)).toMatchObject({ state: 'delivered', attempts: 1 });
});
