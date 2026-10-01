import { afterEach, describe, expect, test } from 'bun:test';
import { BUILTIN_RESOURCES, DomainTopic, IDENTITY_HEADERS, ManifestSchema } from '@crewstation/contracts';
import type { ReleaseId } from '@crewstation/contracts';
import { publishDomainEvent } from '@crewstation/eventbus';
import { createApp } from '@crewstation/http';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { createEventsModule } from '../wiring';
import type { EventIngressSource } from '../ports/ingressSource';
import { eventsDeletionFixture, type EventsDeletionFixture } from './projectDeletionFixture';
import { eventIngressFixture } from './ingressFixture';

const available = await testDatabaseAvailable();
let f: EventsDeletionFixture;
afterEach(async () => { await f?.database.drop(); });

function application(source?: EventIngressSource) {
  const events = createEventsModule({ db: f.database.db, projects: f.project.api, ingressSource: source,
    services: { resolveService: async (id) => { const s = await f.project.api.resolveServiceById(id); return s ? { projectId: s.projectId, serviceId: s.serviceId, slug: s.slug, identity: s.identity } : undefined; } },
    endpoints: { resolve: async () => undefined }, pusher: { push: async () => ({ ok: true }) } });
  const app = createApp({ name: 'events-original-source' });
  for (const route of events.http.ingress) app.route('/', route);
  return { events, app };
}

describe.skipIf(!available)('事件入口原来源（真实 PG / key-ring / ForwardAuth）', () => {
  test('两版入口均要求可核实签名来源；合法事件成功，未登录、用户、伪造、不同身份、未装配和非法正文拒绝', async () => {
    f = await eventsDeletionFixture();
    const sources = eventIngressFixture(f.database.db, f.project.api);
    sources.add({ projectId: f.own.id, serviceId: f.own.serviceId!, slug: f.own.slug });
    const headers = { 'content-type': 'application/json', ...await sources.headers(`${f.own.slug}/${f.own.slug}`) }, { app } = application(sources.ingress);
    for (const version of ['v1', 'v2']) {
      const path = `/${version}/events/produce`, body = JSON.stringify({ ...(version === 'v1' ? { eventType: 'erase.updated' } : { eventTypeId: f.ids.type }), dedupKey: `valid-${version}`, occurredAt: new Date().toISOString(), payload: {} });
      expect((await app.request(path, { method: 'POST', body })).status).toBe(401);
      expect((await app.request(path, { method: 'POST', headers: { [IDENTITY_HEADERS.userId]: f.admin.userId }, body })).status).toBe(403);
      for (const patch of [{ [IDENTITY_HEADERS.sourceToken]: '' }, { [IDENTITY_HEADERS.sourceToken]: 'forged' }, { [IDENTITY_HEADERS.sourceService]: 'other/other' }])
        expect((await app.request(path, { method: 'POST', headers: { ...headers, ...patch }, body })).status).toBe(403);
      expect((await application().app.request(path, { method: 'POST', headers, body })).status).toBe(403);
      expect((await app.request(path, { method: 'POST', headers, body: '{}' })).status).toBe(400);
      expect((await app.request(path, { method: 'POST', headers, body })).status).toBe(202);
    }
  }, 30000);

  for (const version of ['v1', 'v2']) test(`${version} 正文迟到及删除后才抵达的旧签名令牌不进入同名新项目；新来源正常`, async () => {
    f = await eventsDeletionFixture();
    const sources = eventIngressFixture(f.database.db, f.project.api), identity = `${f.own.slug}/${f.own.slug}`;
    sources.add({ projectId: f.own.id, serviceId: f.own.serviceId!, slug: f.own.slug });
    const headers = { 'content-type': 'application/json', ...await sources.headers(identity) };
    let signal!: () => void, controller!: ReadableStreamDefaultController<Uint8Array>, fed = false;
    const admitted = new Promise<void>((resolve) => { signal = resolve; });
    const { app, events } = application({ resolve: async (caller) => { const source = await sources.ingress.resolve(caller); if (source) signal(); return source; } });
    const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; } }, { highWaterMark: 0 });
    const path = `/${version}/events/produce`, pending = app.request(new Request(`http://fixture${path}`, { method: 'POST', headers, body }));
    try {
      await admitted;
      const started = await f.begin(); await f.proceed(started, 'verify'); await f.project.api.completeProjectDeletion(started.lease);
      const replacement = await f.project.api.createProject(f.admin, { slug: f.own.slug, name: 'Replacement', kind: 'EventProducer', template: BUILTIN_RESOURCES.minimalTemplate });
      sources.add({ projectId: replacement.id, serviceId: replacement.serviceId!, slug: replacement.slug });
      const manifest = ManifestSchema.parse({ apiVersion: 'crewstation/v2', kind: 'EventProducer', spec: {
        service: { command: ['app'], port: 3000, servicePlanId: BUILTIN_RESOURCES.servicePlanSmall }, producer: 'erase-source',
        ingress: { path: '/hooks/replacement', verification: 'none' }, produces: [{ eventType: 'erase.updated' }] } });
      await publishDomainEvent(f.database.db, DomainTopic.releaseRegistered, { projectId: replacement.id, serviceId: replacement.serviceId!, releaseId: Bun.randomUUIDv7() as ReleaseId,
        tag: 'v1.0.0', commitSha: 'a'.repeat(40), occurredAt: new Date().toISOString(), manifest });
      await events.subscriptions[0]!.runOnce();
      const type = (await events.api.listEventTypes(f.admin)).find((t) => t.eventType === 'erase.updated');
      expect(type).toBeDefined();
      const input = { ...(version === 'v1' ? { eventType: 'erase.updated' } : { eventTypeId: type!.id }), dedupKey: 'late-original', occurredAt: new Date().toISOString(), payload: {} };
      // 旧实现在此返回 202，把原请求绑定到了新项目；正文前固定 UUID 后必须拒绝。
      controller.enqueue(new TextEncoder().encode(JSON.stringify(input))); controller.close(); fed = true;
      expect((await pending).status).toBe(403);
      expect((await app.request(path, { method: 'POST', headers, body: JSON.stringify(input) })).status).toBe(403);
      expect((await app.request(path, { method: 'POST', headers: { ...headers, ...await sources.headers(identity) }, body: JSON.stringify({ ...input, dedupKey: 'new-source' }) })).status).toBe(202);
      expect((await f.database.db.execute(sql`SELECT id FROM events.inbox WHERE dedup_key='late-original'`)).length).toBe(0);
    } finally { if (!fed) { controller.enqueue(new TextEncoder().encode('{}')); controller.close(); await pending; } }
  }, 30000);
});
