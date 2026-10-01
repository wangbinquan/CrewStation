import { afterEach, describe, expect, test } from 'bun:test';
import { BUILTIN_RESOURCES, DomainTopic, ManifestSchema } from '@crewstation/contracts';
import type { ReleaseId } from '@crewstation/contracts';
import { publishDomainEvent } from '@crewstation/eventbus';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { createEventsModule } from '../wiring';
import { eventsDeletionFixture, type EventsDeletionFixture } from './projectDeletionFixture';

const available = await testDatabaseAvailable();
let f: EventsDeletionFixture;
afterEach(async () => { await f?.database.drop(); });

async function replacement() {
  f = await eventsDeletionFixture();
  const started = await f.begin();
  await f.proceed(started, 'verify');
  await f.project.api.completeProjectDeletion(started.lease);
  const project = await f.project.api.createProject(f.admin, { slug: f.own.slug, name: 'Replacement', kind: 'EventProducer', template: BUILTIN_RESOURCES.minimalTemplate });
  const events = createEventsModule({ db: f.database.db, projects: f.project.api,
    services: { resolveService: async (id) => { const s = await f.project.api.resolveServiceById(id); return s ? { projectId: s.projectId, serviceId: s.serviceId, slug: s.slug, identity: s.identity } : undefined; } },
    endpoints: { resolve: async () => undefined }, pusher: { push: async () => ({ ok: true }) } });
  const manifest = ManifestSchema.parse({ apiVersion: 'crewstation/v2', kind: 'EventProducer', spec: {
    service: { command: ['app'], port: 3000, servicePlanId: BUILTIN_RESOURCES.servicePlanSmall }, producer: 'erase-source',
    ingress: { path: '/hooks/replacement', verification: 'none' }, produces: [{ eventType: 'erase.updated' }] } });
  await publishDomainEvent(f.database.db, DomainTopic.releaseRegistered, { projectId: project.id, serviceId: project.serviceId!, releaseId: Bun.randomUUIDv7() as ReleaseId,
    tag: 'v1.0.0', commitSha: 'a'.repeat(40), occurredAt: new Date().toISOString(), manifest });
  await events.subscriptions[0]!.runOnce();
  const type = (await events.api.listEventTypes(f.admin)).find((t) => t.eventType === 'erase.updated');
  // 原 slug 墓碑曾使正式消费者吞掉新项目登记；名称可复用，原 UUID 不可继承。
  expect(type).toBeDefined();
  const caller = { identity: `${project.slug}/${project.slug}`, project: project.slug, service: project.slug, projectId: project.id, serviceId: project.serviceId! };
  return { project, events, type: type!, caller };
}

describe.skipIf(!available)('同标识新项目的事件原身份（真实 PG）', () => {
  test('旧库升级并删除原根后，同标识新 UUID 可登记生产；旧内容和原生产方身份不能恢复', async () => {
    const { project, events, type, caller } = await replacement();
    expect(project.id).not.toBe(f.own.id);
    expect(project.serviceId).not.toBe(f.own.serviceId);
    const result = await events.api.produce(caller, { eventTypeId: type.id, dedupKey: 'replacement', occurredAt: new Date().toISOString(), payload: { new: true } });
    expect(result).toMatchObject({ deduplicated: false, deliveries: 0 });
    expect((await f.database.db.execute(sql`SELECT project_id FROM events.producers WHERE id=${type.producerId}`))[0]).toEqual({ project_id: project.id });
    expect((await f.database.db.execute(sql`SELECT payload FROM events.inbox WHERE id=${f.ids.event}`)).length).toBe(0);
    await expect(Promise.resolve(f.database.db.execute(sql`INSERT INTO events.producers(id,name,producer,service_id,project_id,project_slug,service_identity,updated_at)
      VALUES (${f.ids.producer},'old','old',${f.own.serviceId},${project.id},${project.slug},${caller.identity},now())`))).rejects.toThrow();
    await expect(Promise.resolve(f.database.db.execute(sql`INSERT INTO events.inbox(id,producer_id,producer,producer_project,event_type_id,event_type,dedup_key,occurred_at,received_at,trace_id,payload)
      VALUES (${Bun.randomUUIDv7()},${Bun.randomUUIDv7()},'unknown',${project.slug},${Bun.randomUUIDv7()},'unknown','unknown',now(),now(),'trace','null'::jsonb)`))).rejects.toThrow();
    expect((await f.database.db.execute(sql`SELECT payload->>'private' AS material FROM events.inbox WHERE id=${f.ids.foreignEvent}`))[0]).toEqual({ material: 'retain-payload' });
  }, 30000);

  test('已固定原项目与服务的迟到 v1 调用不能按相同编码绑定新项目，新调用正常受理', async () => {
    const { events, caller } = await replacement();
    const input = { eventType: 'erase.updated', dedupKey: 'old-request', occurredAt: new Date().toISOString(), payload: { old: true } };
    // 名称都相同也必须核对原 UUID，曾被旧名称校验错误受理。
    await expect(events.api.produceLegacy({ ...caller, projectId: f.own.id, serviceId: f.own.serviceId! }, input)).rejects.toThrow();
    await expect(events.api.produceLegacy({ ...caller, serviceId: f.own.serviceId! }, input)).rejects.toThrow();
    expect((await events.api.produceLegacy(caller, { ...input, dedupKey: 'new-request' })).deduplicated).toBe(false);
    expect((await f.database.db.execute(sql`SELECT id FROM events.inbox WHERE dedup_key='old-request'`)).length).toBe(0);
  }, 30000);
});
