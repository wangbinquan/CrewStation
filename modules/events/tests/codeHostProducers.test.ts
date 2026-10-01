import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import type { Actor, Manifest, ProjectId, ReleaseId, ServiceId, TraceId } from '@crewstation/contracts';
import { BUILTIN_RESOURCES, DomainTopic, EventDeliverySchema, IDENTITY_HEADERS, ManifestSchema } from '@crewstation/contracts';
import { eventbusMigrations, publishDomainEvent } from '@crewstation/eventbus';
import { createApp } from '@crewstation/http';
import { createIdentityModule, identityMigrations } from '@crewstation/module-identity';
import { createProjectModule, projectMigrations } from '@crewstation/module-project';
import { queueMigrations } from '@crewstation/queue';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { createApp as githubApp } from '../../../integrations/github-event-producer/src/main';
import { createApp as gitlabApp } from '../../../integrations/gitlab-event-producer/src/main';
import { createEventsModule, eventsMigrations } from '../wiring';
import type { EventsModule } from '../wiring';
import { eventIngressFixture } from './ingressFixture';

const available = await testDatabaseAvailable();
let tdb: TestDatabase;
let events: EventsModule;
let admin: Actor;
let consumer: { projectId: ProjectId; serviceId: ServiceId };
const endpoints = new Map<ServiceId, string>();
const received: Array<{ slot: string; body: ReturnType<typeof EventDeliverySchema.parse> }> = [];
const servers: Array<ReturnType<typeof Bun.serve>> = [];
let failing = true;
const service = { command: ['bun', 'run', 'src/main.ts'], port: 3000, servicePlanId: BUILTIN_RESOURCES.servicePlanSmall };
const apps = new Map<string, ReturnType<typeof githubApp>>();
let loseReceipt = false;

async function register(target: { projectId: ProjectId; serviceId: ServiceId }, manifest: Manifest): Promise<void> {
  await publishDomainEvent(tdb.db, DomainTopic.releaseRegistered, { ...target, occurredAt: new Date().toISOString(),
    releaseId: Bun.randomUUIDv7() as ReleaseId, tag: 'v1.0.0', commitSha: 'a'.repeat(40), manifest });
  await events.subscriptions[0]!.runOnce();
}
async function advanceTime(): Promise<void> {
  await tdb.db.execute(`UPDATE platform_infra.jobs SET run_at = now() WHERE state = 'pending'`);
  await tdb.db.execute(`UPDATE events.deliveries SET next_attempt_at = now() WHERE state = 'retrying'`);
}

beforeAll(async () => {
  if (!available) return;
  tdb = await createTestDatabase([eventbusMigrations, queueMigrations, identityMigrations, projectMigrations, eventsMigrations]);
  const identity = createIdentityModule({ db: tdb.db, settings: { adminEmails: [] } });
  const user = await identity.api.ensureUser({ externalId: 'code-host-owner', name: 'Owner', email: 'owner@example.com' });
  if (user.platformRole === 'user') await identity.api.setPlatformRole(user.id, { platformRole: 'developer', expectedRole: 'user' });
  admin = { userId: user.id, isAdmin: true };
  const projects = createProjectModule({ db: tdb.db, identity: identity.api, hosts: { prodHost: (s) => `${s}.local`, previewHost: (s) => `preview.${s}.local`, serviceHost: (s) => `${s}.svc.local` },
    settings: { defaultMaxConcurrentTasks: 3, defaultServicePlan: BUILTIN_RESOURCES.servicePlanSmall } });
  await projects.api.updateServicePlan(admin, BUILTIN_RESOURCES.servicePlanSmall, { name: 'small', cpu: '500m', memory: '512Mi', maxReplicas: 3, description: '' });
  const sources = eventIngressFixture(tdb.db, projects.api);
  events = createEventsModule({ db: tdb.db, projects: projects.api,
    ingressSource: sources.ingress,
    services: { resolveService: async (id) => { const s = await projects.api.getService(admin, id); return { projectId: s.projectId, serviceId: s.id, slug: s.name, identity: s.identity }; } },
    endpoints: { resolve: async (id) => { const baseUrl = endpoints.get(id); return baseUrl ? { baseUrl } : undefined; } },
    settings: { maxAttempts: 2, pushTimeoutMs: 2000 } });
  const ingress = createApp({ name: 'code-host-ingress' });
  for (const route of events.http.ingress) ingress.route('/', route);
  for (const name of ['gitlab', 'github', 'consumer']) {
    const dto = await projects.api.createProject(admin, { slug: name, name, kind: name === 'consumer' ? 'DigitalWorker' : 'EventProducer', ownerUserId: user.id, template: BUILTIN_RESOURCES.minimalTemplate });
    const target = { projectId: dto.id, serviceId: dto.serviceId! };
    sources.add({ ...target, slug: name });
    if (name === 'consumer') { consumer = target; continue; }
    const manifest = ManifestSchema.parse(Bun.YAML.parse(await Bun.file(`${import.meta.dir}/../../../integrations/${name}-event-producer/crewstation.yaml`).text()));
    await register(target, manifest);
    const eventsFetch = async (url: string, init?: RequestInit): Promise<Response> => {
      const headers = new Headers(init?.headers);
      headers.set(IDENTITY_HEADERS.sourceService, `${name}/${name}`);
      headers.set(IDENTITY_HEADERS.sourceSlot, 'prod');
      for (const [key, value] of Object.entries(await sources.headers(`${name}/${name}`))) headers.set(key, value);
      const response = await ingress.request(url, { ...init, headers });
      if (loseReceipt && response.ok) { loseReceipt = false; throw new Error('receipt lost after commit'); }
      return response;
    };
    const env = { GITHUB_WEBHOOK_SECRET: 'secret', GITLAB_WEBHOOK_SECRET_TOKEN: 'secret', EVENTS_BASE_URL: 'http://events' };
    apps.set(name, (name === 'github' ? githubApp : gitlabApp)({ env, eventsFetch, log: () => {} }));
  }
  const types = await events.api.listEventTypes(admin);
  await register(consumer, ManifestSchema.parse({ apiVersion: 'crewstation/v2', kind: 'DigitalWorker', spec: { service,
    subscriptions: types.map((type) => ({ eventTypeId: type.id, handlerPath: '/events' })) } }));
  for (const slot of ['blue', 'green']) servers.push(Bun.serve({ port: 0, fetch: async (req) => {
    received.push({ slot, body: EventDeliverySchema.parse(await req.json()) });
    return new Response(null, { status: failing ? 500 : 204 });
  } }));
  endpoints.set(consumer.serviceId, `http://127.0.0.1:${servers[0]!.port}`);
});
afterAll(async () => { for (const server of servers) server.stop(true); await tdb?.drop(); });

function webhook(name: string, id: string): Request {
  const payload = name === 'gitlab'
    ? { object_kind: 'note', project: { id: 1 }, object_attributes: { id: 2, noteable_type: 'MergeRequest', note: 'agent fix this', created_at: '2026-09-27T00:00:00Z' }, merge_request: { id: 3, iid: 1 } }
    : { action: 'created', repository: { id: 1 }, issue: { id: 3, number: 1, pull_request: { url: 'https://api.github.com/repos/o/r/pulls/1' } }, comment: { id: 2, body: 'agent fix this', created_at: '2026-09-27T00:00:00Z' } };
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-cs-trace-id': 'c'.repeat(32) };
  if (name === 'gitlab') Object.assign(headers, { 'x-gitlab-token': 'secret', 'x-gitlab-event': 'Note Hook', 'idempotency-key': id });
  else Object.assign(headers, { 'x-github-event': 'issue_comment', 'x-github-delivery': id, 'x-hub-signature-256': `sha256=${createHmac('sha256', 'secret').update(body).digest('hex')}` });
  return new Request(`http://producer/hooks/${name}`, { method: 'POST', headers, body });
}

describe.skipIf(!available)('RFC-033 producer → PostgreSQL events → HTTP consumer', () => {
  test('both real producers preserve payload and deduplicate a lost persistence receipt', async () => {
    expect((await events.api.listEventTypes(admin)).length).toBe(40);
    for (const name of ['gitlab', 'github']) {
      const app = apps.get(name)!;
      loseReceipt = true;
      expect((await app.request(webhook(name, 'delivery-1'))).status).toBe(503);
      const replay = await app.request(webhook(name, 'delivery-1'));
      expect(replay.status).toBe(202);
      expect(await replay.json()).toMatchObject({ accepted: true, deduplicated: true, deliveries: 0 });
    }
    const rows = await tdb.db.execute(`SELECT payload FROM events.inbox`);
    expect(rows).toHaveLength(2);
    expect(await events.api.listDeliveries(admin, consumer.projectId)).toHaveLength(2);
  });
  test('consumer failure retries then dead-letters; replay keeps IDs and resolves the new active slot', async () => {
    expect(await events.workers[0]!.runOnce()).toBe(2);
    expect((await events.api.listDeliveries(admin, consumer.projectId)).every((d) => d.state === 'retrying')).toBe(true);
    await advanceTime();
    expect(await events.workers[0]!.runOnce()).toBe(2);
    const dead = await events.api.listDeliveries(admin, consumer.projectId, { state: 'dead' });
    expect(dead).toHaveLength(2);
    failing = false;
    endpoints.set(consumer.serviceId, `http://127.0.0.1:${servers[1]!.port}`);
    for (const delivery of dead) await events.api.replayDelivery(admin, delivery.id);
    expect(await events.workers[0]!.runOnce()).toBe(2);
    expect(await events.api.listDeliveries(admin, consumer.projectId, { state: 'delivered' })).toHaveLength(2);
    for (const delivery of dead) {
      const attempts = received.filter((item) => item.body.deliveryId === delivery.id);
      expect(attempts.map((item) => item.slot)).toEqual(['blue', 'blue', 'green']);
      expect(attempts.map((item) => item.body.attempt)).toEqual([1, 2, 1]);
      expect(new Set(attempts.map((item) => item.body.eventId)).size).toBe(1);
      expect(attempts[2]!.body.traceId).toBe('c'.repeat(32) as TraceId);
      const name = attempts[2]!.body.source.producer;
      expect(attempts[2]!.body.payload).toEqual(await webhook(name, 'unused').json());
    }
  });
});
