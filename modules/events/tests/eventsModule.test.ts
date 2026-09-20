import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Actor, EventId, Manifest, ProjectId, ReleaseId, ServiceActor, ServiceId, TraceId, UserId } from '@crewstation/contracts';
import { BUILTIN_RESOURCES, DomainTopic, EVENT_HEADERS, EventDeliverySchema, IDENTITY_HEADERS, ManifestSchema } from '@crewstation/contracts';
import { eventbusMigrations, publishDomainEvent } from '@crewstation/eventbus';
import { createApp } from '@crewstation/http';
import { newId } from '@crewstation/kernel';
import { createIdentityModule, identityMigrations } from '@crewstation/module-identity';
import type { ProjectModule } from '@crewstation/module-project';
import { createProjectModule, projectMigrations } from '@crewstation/module-project';
import { queueMigrations } from '@crewstation/queue';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { EventsModule } from '../wiring';
import { createEventsModule, eventsMigrations } from '../wiring';

interface Target { projectId: ProjectId; serviceId: ServiceId }
interface Received { path: string; headers: Record<string, string>; body: unknown }

const available = await testDatabaseAvailable();
let tdb: TestDatabase;
let project: ProjectModule;
let events: EventsModule;
let admin: Actor;
let owner: Actor;
let dev: Actor;
let producerProject: Target;
let demo: Target;
let other: Target;
let subscriber: ReturnType<typeof Bun.serve>;
let subscriberMode: 'ok' | 'fail' = 'fail';
const received: Received[] = [];
const endpoints = new Map<ServiceId, string>();
const eventTypes = new Map<string, { id: string; producerId: string }>();
const typeId = (code: string): string => eventTypes.get(code)!.id;
const PIPELINE = 'gitlab.pipeline.finished';
const gitlab: ServiceActor = { identity: 'gitlab-events/gitlab-events', project: 'gitlab-events', service: 'gitlab-events', slot: 'prod' };

const hosts = { prodHost: (s: string) => `${s}.cs.localhost`, previewHost: (s: string) => `preview.${s}.cs.localhost`, serviceHost: (s: string) => `${s}.svc.cs.internal` };
const service = { command: ['bun', 'run', 'src/main.ts'], port: 3000, servicePlanId: BUILTIN_RESOURCES.servicePlanSmall };
const producerManifest = (producer: string, types: string[]): Manifest => ManifestSchema.parse({
  apiVersion: 'crewstation/v2', kind: 'EventProducer',
  spec: { service, producer, ingress: { path: '/hooks/gitlab', verification: 'gitlab-token' }, produces: types.map((eventType) => ({ eventType, ...(eventType === PIPELINE ? { schema: './schemas/pipeline.json' } : {}) })) },
});
const subscriberManifest = (subscriptions: Array<{ eventType: string; handlerPath: string }>): Manifest => ManifestSchema.parse({ apiVersion: 'crewstation/v2', kind: 'DigitalWorker', spec: { service, subscriptions: subscriptions.map(({ eventType, handlerPath }) => ({ eventTypeId: typeId(eventType), handlerPath })) } });

/** 发布登记事件并让消费者跑一轮；runOnce 会一并消费游标之后的所有事件，所以只断言效果。 */
async function registerRelease(target: Target, manifest: Manifest): Promise<void> {
  await publishDomainEvent(tdb.db, DomainTopic.releaseRegistered, {
    occurredAt: new Date().toISOString(), projectId: target.projectId, serviceId: target.serviceId, releaseId: newId('rel') as ReleaseId,
    tag: 'v1.0.0', commitSha: 'a'.repeat(40), manifest,
  });
  await events.subscriptions[0]!.runOnce();
}

async function jobStates(): Promise<string[]> {
  const rows = (await tdb.db.execute(`SELECT state FROM platform_infra.jobs WHERE kind = 'events.deliver' ORDER BY id`)) as unknown as Array<{ state: string }>;
  return rows.map((r) => r.state);
}

/** 队列 run_at 与投递 next_attempt_at 都在未来；测试直接把时间拨到现在，不等待退避。 */
async function advanceTime(): Promise<void> {
  await tdb.db.execute(`UPDATE platform_infra.jobs SET run_at = now() WHERE state = 'pending'`);
  await tdb.db.execute(`UPDATE events.deliveries SET next_attempt_at = now() WHERE state = 'retrying'`);
}

beforeAll(async () => {
  if (!available) return;
  tdb = await createTestDatabase([eventbusMigrations, queueMigrations, identityMigrations, projectMigrations, eventsMigrations]);
  const identity = createIdentityModule({ db: tdb.db, settings: { adminEmails: [] } });
  const a = await identity.api.ensureUser({ externalId: 'demo:admin', name: 'Admin', email: 'admin@example.com' });
    if (a.platformRole === 'user') await identity.api.setPlatformRole(a.id, { platformRole: 'developer', expectedRole: 'user' });
  const o = await identity.api.ensureUser({ externalId: 'demo:owner', name: 'Owner', email: 'owner@example.com' });
    if (o.platformRole === 'user') await identity.api.setPlatformRole(o.id, { platformRole: 'developer', expectedRole: 'user' });
  const d = await identity.api.ensureUser({ externalId: 'demo:dev', name: 'Dev', email: 'dev@example.com' });
    if (d.platformRole === 'user') await identity.api.setPlatformRole(d.id, { platformRole: 'developer', expectedRole: 'user' });
  admin = { userId: a.id, isAdmin: true };
  owner = { userId: o.id, isAdmin: false };
  dev = { userId: d.id, isAdmin: false };
  project = createProjectModule({ db: tdb.db, identity: identity.api, hosts, settings: { defaultMaxConcurrentTasks: 3, defaultServicePlan: BUILTIN_RESOURCES.servicePlanSmall } });
  await project.api.updateServicePlan(admin, BUILTIN_RESOURCES.servicePlanSmall, { name: 'standard-small', cpu: '500m', memory: '512Mi', maxReplicas: 3, description: '' });
  const create = async (slug: string, kind: 'DigitalWorker' | 'EventProducer'): Promise<Target> => {
    const dto = await project.api.createProject(admin, { slug, name: slug, kind, ownerUserId: owner.userId, template: BUILTIN_RESOURCES.minimalTemplate });
    return { projectId: dto.id, serviceId: dto.serviceId! };
  };
  producerProject = await create('gitlab-events', 'EventProducer');
  demo = await create('demo', 'DigitalWorker');
  other = await create('other', 'DigitalWorker');
  await project.api.setMember(owner, demo.projectId, { userId: dev.userId, role: 'developer' });
  await project.api.setMember(owner, other.projectId, { userId: dev.userId, role: 'developer' });
  subscriber = Bun.serve({
    port: 0,
    fetch: async (req) => {
      received.push({ path: new URL(req.url).pathname, headers: Object.fromEntries(req.headers), body: await req.json() });
      return subscriberMode === 'ok' ? new Response('ok') : new Response('boom', { status: 500 });
    },
  });
  endpoints.set(demo.serviceId, `http://127.0.0.1:${subscriber.port}`);
  events = createEventsModule({
    db: tdb.db,
    projects: project.api,
    services: {
      resolveService: async (serviceId) => {
        const s = await project.api.getService(admin, serviceId).catch(() => undefined);
        return s ? { projectId: s.projectId, serviceId: s.id, slug: s.name, identity: s.identity } : undefined;
      },
    },
    endpoints: { resolve: async (serviceId) => { const baseUrl = endpoints.get(serviceId); return baseUrl ? { baseUrl } : undefined; } },
    settings: { maxAttempts: 2, pushTimeoutMs: 2000 },
  });
});
afterAll(async () => {
  subscriber?.stop(true);
  await tdb?.drop();
});

describe.skipIf(!available)('events module', () => {
  let eventId: EventId;
  const traceId = 'a'.repeat(32) as TraceId;
  let demoDelivery: string;
  let otherDelivery: string;

  test('release.registered：生产方与事件类型登记，数字人订阅替换并保持 id 稳定', async () => {
    await registerRelease(producerProject, producerManifest('gitlab', [PIPELINE, 'gitlab.push']));
    for (const type of await events.api.listEventTypes(dev)) eventTypes.set(type.eventType, type);
    await registerRelease(demo, subscriberManifest([{ eventType: PIPELINE, handlerPath: '/events/old' }, { eventType: 'gitlab.push', handlerPath: '/events/push' }]));
    await registerRelease(other, subscriberManifest([{ eventType: PIPELINE, handlerPath: '/hooks' }]));
    expect(await events.api.listEventTypes(dev)).toEqual([
      { name: PIPELINE, state: 'active', id: typeId(PIPELINE), producerId: eventTypes.get(PIPELINE)!.producerId, eventType: PIPELINE, producer: 'gitlab', producerProject: 'gitlab-events', schemaRef: './schemas/pipeline.json' },
      { name: 'gitlab.push', state: 'active', id: typeId('gitlab.push'), producerId: eventTypes.get('gitlab.push')!.producerId, eventType: 'gitlab.push', producer: 'gitlab', producerProject: 'gitlab-events' },
    ]);
    const before = await events.api.listSubscriptions(owner, demo.projectId);
    expect(before.map((s) => [s.eventType, s.handlerPath, s.state])).toEqual([[PIPELINE, '/events/old', 'active'], ['gitlab.push', '/events/push', 'active']]);
    await registerRelease(demo, subscriberManifest([{ eventType: PIPELINE, handlerPath: '/events/pipeline' }]));
    const after = await events.api.listSubscriptions(owner, demo.projectId);
    expect(after.map((s) => [s.id, s.handlerPath])).toEqual([[before[0]!.id, '/events/pipeline']]);
    await expect(events.api.listSubscriptions({ userId: '01a0bf5d-8f4b-7622-8c1a-d607ceefa8df' as UserId, isAdmin: false }, demo.projectId)).rejects.toMatchObject({ kind: 'not_found' });
  });

  test('produce：生产方身份核对、未知事件类型、去重与每订阅一条投递入队', async () => {
    const input = { eventTypeId: typeId(PIPELINE), dedupKey: 'pipeline-1', occurredAt: '2026-09-11T08:00:00.000Z', traceId, payload: { pipeline: 42, status: 'success' } };
    await expect(events.api.produce({ identity: 'demo/demo', project: 'demo', service: 'demo' }, input)).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(events.api.produce(gitlab, { ...input, eventTypeId: Bun.randomUUIDv7() })).rejects.toMatchObject({ kind: 'not_found' });
    const result = await events.api.produce(gitlab, input);
    expect(result).toMatchObject({ deduplicated: false, deliveries: 2 });
    expect(result.eventId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    eventId = result.eventId;
    expect(await events.api.produce(gitlab, { ...input, payload: { different: true } })).toEqual({ eventId, deduplicated: true, deliveries: 0 });
    const demoDeliveries = await events.api.listDeliveries(owner, demo.projectId);
    expect(demoDeliveries).toHaveLength(1);
    expect(demoDeliveries[0]).toMatchObject({ eventId, eventType: PIPELINE, state: 'pending', attempts: 0, traceId });
    demoDelivery = demoDeliveries[0]!.id;
    otherDelivery = (await events.api.listDeliveries(owner, other.projectId))[0]!.id;
    expect(await jobStates()).toEqual(['pending', 'pending']);
    const stored = (await tdb.db.execute(`SELECT jsonb_typeof(payload) AS kind, payload->>'pipeline' AS pipeline FROM events.inbox`)) as unknown as Array<{ kind: string; pipeline: string }>;
    expect(stored).toEqual([{ kind: 'object', pipeline: '42' }]);
  });

  test('worker：500 与无 active 槽都进入 retrying；重试后 delivered，信封与头正确；超过上限 dead', async () => {
    expect(await events.workers[0]!.runOnce()).toBe(2);
    const demoRetrying = (await events.api.listDeliveries(owner, demo.projectId))[0]!;
    expect(demoRetrying).toMatchObject({ state: 'retrying', attempts: 1, lastError: 'HTTP 500' });
    expect(new Date(demoRetrying.nextAttemptAt!).getTime()).toBeGreaterThan(Date.now());
    expect((await events.api.listDeliveries(owner, other.projectId))[0]).toMatchObject({ state: 'retrying', attempts: 1, lastError: '订阅方没有 active 槽' });
    expect(received).toHaveLength(1);
    expect(await jobStates()).toEqual(['pending', 'pending']);
    await advanceTime();
    subscriberMode = 'ok';
    expect(await events.workers[0]!.runOnce()).toBe(2);
    const delivered = (await events.api.listDeliveries(owner, demo.projectId, { state: 'delivered' }))[0]!;
    expect(delivered).toMatchObject({ id: demoDelivery, state: 'delivered', attempts: 2 });
    expect(delivered.deliveredAt).toBeDefined();
    expect(delivered.lastError).toBeUndefined();
    expect(received).toHaveLength(2);
    const last = received[1]!;
    expect(last.path).toBe('/events/pipeline');
    expect(last.headers).toMatchObject({ [EVENT_HEADERS.eventType]: PIPELINE, [EVENT_HEADERS.deliveryId]: demoDelivery, [EVENT_HEADERS.deliveryAttempt]: '2', [IDENTITY_HEADERS.traceId]: traceId, 'content-type': 'application/json' });
    expect(EventDeliverySchema.parse(last.body)).toMatchObject({
      deliveryId: demoDelivery, eventId, eventType: PIPELINE, source: { producer: 'gitlab', project: 'gitlab-events' },
      occurredAt: '2026-09-11T08:00:00.000Z', traceId, attempt: 2, payload: { pipeline: 42, status: 'success' },
    });
    expect((await events.api.listDeliveries(owner, other.projectId))[0]).toMatchObject({ id: otherDelivery, state: 'dead', attempts: 2 });
    expect(await jobStates()).toEqual(['done', 'done']);
    expect(await events.workers[0]!.runOnce()).toBe(0);
  });

  test('replay：只有负责人、只有 dead；重放后重新计数并再次入队', async () => {
    await expect(events.api.replayDelivery(dev, otherDelivery)).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(events.api.replayDelivery(owner, demoDelivery)).rejects.toMatchObject({ kind: 'precondition' });
    await expect(events.api.replayDelivery(owner, '01a0bf5d-8f4b-7620-8dc5-e6b70c33a3e2')).rejects.toMatchObject({ kind: 'not_found' });
    const replayed = await events.api.replayDelivery(owner, otherDelivery);
    expect(replayed).toMatchObject({ state: 'pending', attempts: 0 });
    expect(replayed.lastError).toBeUndefined();
    expect(await jobStates()).toEqual(['done', 'done', 'pending']);
    endpoints.set(other.serviceId, `http://127.0.0.1:${subscriber.port}/`);
    expect(await events.workers[0]!.runOnce()).toBe(1);
    expect((await events.api.listDeliveries(owner, other.projectId))[0]).toMatchObject({ state: 'delivered', attempts: 1 });
    expect(received[2]).toMatchObject({ path: '/hooks', headers: { [EVENT_HEADERS.deliveryAttempt]: '1' } });
    expect(await events.api.listDeliveries(owner, other.projectId, { state: 'dead' })).toEqual([]);
  });

  test('订阅被移除后待投递的记录直接 dead；没给 traceId 时由 cs-events 生成', async () => {
    const result = await events.api.produce(gitlab, { eventTypeId: typeId(PIPELINE), dedupKey: 'pipeline-2', occurredAt: new Date().toISOString(), payload: null });
    expect(result.deliveries).toBe(2);
    const pending = (await events.api.listDeliveries(owner, other.projectId, { state: 'pending' }))[0]!;
    expect(pending.traceId).toMatch(/^[0-9a-f]{32}$/);
    await registerRelease(other, subscriberManifest([]));
    expect(await events.api.listSubscriptions(owner, other.projectId)).toEqual([]);
    expect(await events.workers[0]!.runOnce()).toBe(2);
    expect((await events.api.listDeliveries(owner, other.projectId, { state: 'dead' }))[0]).toMatchObject({ id: pending.id, lastError: '订阅已被移除' });
    expect((await events.api.listDeliveries(owner, demo.projectId, { state: 'delivered' })).length).toBe(2);
  });

  test('HTTP：服务域 ingress 用来源服务身份，用户域查询与重放', async () => {
    const app = createApp({ name: 'test' });
    for (const router of [...events.http.ingress, ...events.http.query]) app.route('/', router);
    const json = { 'content-type': 'application/json' };
    const asUser = (actor: Actor) => ({ [IDENTITY_HEADERS.userId]: actor.userId });
    const body = JSON.stringify({ eventTypeId: typeId(PIPELINE), dedupKey: 'pipeline-3', occurredAt: new Date().toISOString(), payload: { n: 3 } });
    expect((await app.request('/v2/events/produce', { method: 'POST', headers: json, body })).status).toBe(401);
    expect((await app.request('/v2/events/produce', { method: 'POST', headers: { ...json, ...asUser(admin) }, body })).status).toBe(403);
    const produced = await app.request('/v2/events/produce', { method: 'POST', headers: { ...json, [IDENTITY_HEADERS.sourceService]: gitlab.identity, [IDENTITY_HEADERS.sourceSlot]: 'prod' }, body });
    expect(produced.status).toBe(202);
    expect(await produced.json()).toMatchObject({ deduplicated: false, deliveries: 1 });
    expect((await app.request('/v2/events/produce', { method: 'POST', headers: { ...json, [IDENTITY_HEADERS.sourceService]: gitlab.identity }, body: JSON.stringify({ eventType: PIPELINE }) })).status).toBe(400);
    expect((await app.request('/v2/events/produce', { method: 'POST', headers: { ...json, [IDENTITY_HEADERS.sourceService]: 'demo/demo' }, body })).status).toBe(403);
    const types = await app.request('/v1/catalog/event-types', { headers: asUser(dev) });
    expect(((await types.json()) as { items: unknown[] }).items).toHaveLength(2);
    const subs = await app.request(`/v1/projects/${demo.projectId}/subscriptions`, { headers: asUser(dev) });
    expect(((await subs.json()) as { items: Array<{ handlerPath: string }> }).items.map((s) => s.handlerPath)).toEqual(['/events/pipeline']);
    const deliveries = await app.request(`/v1/projects/${demo.projectId}/deliveries?state=delivered&limit=1`, { headers: asUser(owner) });
    expect(((await deliveries.json()) as { items: unknown[] }).items).toHaveLength(1);
    expect((await app.request(`/v1/projects/${demo.projectId}/deliveries?state=bogus`, { headers: asUser(owner) })).status).toBe(400);
    expect((await app.request(`/v1/projects/${demo.projectId}/deliveries`, { headers: asUser({ userId: '01a0bf5d-8f4b-7622-8c1a-d607ceefa8df' as UserId, isAdmin: false }) })).status).toBe(404);
    expect((await app.request(`/v1/deliveries/${demoDelivery}/replay`, { method: 'POST', headers: asUser(owner) })).status).toBe(412);
    expect((await app.request(`/v1/deliveries/${demoDelivery}/replay`, { method: 'POST', headers: asUser(dev) })).status).toBe(403);
  });

  test('另一个服务抢注同名生产方或已声明的事件类型：登记被拒并进入死信，原登记不变', async () => {
    await registerRelease(demo, producerManifest('gitlab', ['gitlab.other']));
    for (let i = 0; i < 10; i += 1) await events.subscriptions[0]!.runOnce();
    expect((await events.api.listEventTypes(dev)).map((t) => t.producer)).toEqual(['gitlab', 'gitlab']);
    const dead = (await tdb.db.execute(`SELECT consumer, error FROM platform_infra.event_dead_letters`)) as unknown as Array<{ consumer: string; error: string }>;
    expect(dead).toHaveLength(1);
    expect(dead[0]).toMatchObject({ consumer: 'events' });
    expect(dead[0]!.error).toContain('gitlab');
  });
});
