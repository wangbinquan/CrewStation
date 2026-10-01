import { afterEach, describe, expect, test } from 'bun:test';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { eventsDeletionFixture, type EventsDeletionFixture } from './projectDeletionFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('events 永久删除（真实 PG）', () => {
  let f: EventsDeletionFixture;
  afterEach(async () => { await f?.database.drop(); });
  test('旧库升级完整盘点 1502 条历史，删除原事件与派生投递；其他来源、订阅配置原文保留', async () => {
    f = await eventsDeletionFixture();
    await f.database.db.execute(sql`INSERT INTO events.inbox(id,producer_id,producer,producer_project,event_type_id,event_type,dedup_key,occurred_at,received_at,trace_id,payload) SELECT md5('owned-event-'||n)::uuid::text,${f.ids.producer},'erase-source',${f.own.slug},${f.ids.type},'erase.updated','history-'||n,now(),now(),'private-trace-'||n,jsonb_build_object('private','erase-history-'||n) FROM generate_series(1,1502) AS n`);
    const owner = f.events.api.deletionOwner!, started = await f.begin();
    expect(started.context.confirmed.complete).toBe(true);
    expect(started.context.confirmed.resources.find((r) => r.kind === 'inbox')?.count).toBe(1503);
    expect(started.context.confirmed.references.map((r) => r.id)).toContain(f.other.id);
    const [before] = await f.database.db.execute<{ body: object }>(sql`SELECT to_jsonb(i) AS body FROM events.inbox i WHERE id=${f.ids.foreignEvent}`);
    expect((await owner.run(started.context)).kind).toBe('done');
    await f.proceed(started,'metadata');
    expect((await owner.run({ ...started.context,phase: 'metadata' })).kind).toBe('done');
    await f.proceed(started,'verify');
    expect((await f.project.api.completeProjectDeletion(started.lease)).state).toBe('succeeded');
    expect((await owner.inspect(started.context.target)).resources.every((r) => r.count === 0)).toBe(true);
    expect((await f.database.db.execute<{ body: object }>(sql`SELECT to_jsonb(i) AS body FROM events.inbox i WHERE id=${f.ids.foreignEvent}`))[0]).toEqual(before);
    expect((await f.database.db.execute<{ handler_path: string; state: string }>(sql`SELECT handler_path,state FROM events.subscriptions WHERE id=${f.ids.incoming}`))[0]).toEqual({ handler_path: '/retain-handler', state: 'paused' });
    expect((await f.database.db.execute<{ last_error: string; state: string }>(sql`SELECT last_error,state FROM events.deliveries WHERE id=${f.ids.foreignDelivery}`))[0]).toEqual({ last_error: 'retain-error', state: 'pending' });
    expect((await f.database.db.execute(sql`SELECT id FROM events.deliveries WHERE id IN (${f.ids.delivery},${f.ids.incomingDelivery})`)).length).toBe(0);
    const text = JSON.stringify(await f.database.db.execute(sql`SELECT to_jsonb(e) AS body FROM events.deletion_entities e`));
    expect(text).not.toContain('payload'); expect(text).not.toContain('handler'); expect(text).not.toContain('private-trace');
  },30_000);
  test('关闭源和订阅方的新登记、生产、重放及旧 ID 写入；删除后也不能借换项目复活', async () => {
    f = await eventsDeletionFixture(); const owner = f.events.api.deletionOwner!, started = await f.begin();
    expect((await owner.run(started.context)).kind).toBe('done');
    await expect(f.events.api.produce({ identity: `${f.own.slug}/${f.own.slug}`, project: f.own.slug, service: f.own.slug, projectId: f.own.id, serviceId: f.own.serviceId! }, { eventTypeId: f.ids.type, dedupKey: 'late', occurredAt: new Date().toISOString(), payload: 'private' })).rejects.toThrow();
    await expect(f.events.api.deliver(f.ids.incomingDelivery)).rejects.toThrow();
    await expect(f.events.api.deliver(f.ids.delivery)).rejects.toThrow();
    await expect(Promise.resolve(f.database.db.execute(sql`UPDATE events.producers SET project_id=${f.other.id} WHERE id=${f.ids.producer}`))).rejects.toThrow();
    await expect(Promise.resolve(f.database.db.execute(sql`UPDATE events.subscriptions SET state='active' WHERE id=${f.ids.incoming}`))).rejects.toThrow();
    await expect(Promise.resolve(f.database.db.execute(sql`DELETE FROM events.inbox WHERE id=${f.ids.event}`))).rejects.toThrow();
    await f.proceed(started,'metadata');
    await expect(Promise.resolve(f.database.db.execute(sql`INSERT INTO events.producers(id,name,producer,service_id,project_id,project_slug,service_identity,updated_at) VALUES (${f.ids.producer},'new','new',${f.other.serviceId},${f.other.id},${f.other.slug},'new/new',now())`))).rejects.toThrow();
    await expect(Promise.resolve(f.database.db.execute(sql`INSERT INTO events.event_types(id,name,state,event_type,producer_id,producer,producer_project,schema_ref) VALUES (${f.ids.type},'revived','active','revived',${f.ids.foreignProducer},'retain-source',${f.source.slug},null)`))).rejects.toThrow();
    await expect(Promise.resolve(f.database.db.execute(sql`INSERT INTO events.deliveries(id,event_id,subscription_id,service_id,project_id,event_type_id,event_type,state,attempts,next_attempt_at,last_error,trace_id,delivered_at,created_at,updated_at) VALUES (${f.ids.delivery},${f.ids.foreignEvent},${f.ids.foreignSubscription},${f.other.serviceId},${f.other.id},${f.ids.foreignType},'retain.updated','pending',0,now(),null,'new',null,now(),now())`))).rejects.toThrow();
    expect((await f.events.api.deliver(f.ids.foreignDelivery)).state).toBe('retrying');
  },20_000);
  test('确认后内容变化持续封闭，普通重试与错误世代不能绕过；未登记表和孤儿来源阻断盘点', async () => {
    f = await eventsDeletionFixture(); const owner = f.events.api.deletionOwner!, started = await f.begin();
    await f.database.db.execute(sql`UPDATE events.inbox SET payload='"changed-secret"'::jsonb WHERE id=${f.ids.event}`);
    for (let n = 0; n < 2; n += 1) expect((await owner.run(started.context)).kind).toBe('blocked');
    await expect(owner.run({ ...started.context, phase: 'metadata' })).rejects.toThrow();
    await expect(owner.run({ ...started.context, generation: 0 })).rejects.toThrow();
    await expect(owner.run({ ...started.context, operationId: Bun.randomUUIDv7() })).rejects.toThrow();
    await f.database.db.execute(sql`CREATE TABLE events.unregistered(project_id text,private text)`);
    await expect(owner.inspect(started.context.target)).rejects.toThrow('未登记');
  });
  test('原生产／消费关系不可换源，其他项目可移除已经失效的订阅而不能恢复本项目内容',async () => {
    f = await eventsDeletionFixture();
    await expect(Promise.resolve(f.database.db.execute(sql`UPDATE events.deliveries SET event_id=${f.ids.foreignEvent} WHERE id=${f.ids.incomingDelivery}`))).rejects.toThrow();
    await expect(Promise.resolve(f.database.db.execute(sql`UPDATE events.subscriptions SET event_type_id=${f.ids.foreignType} WHERE id=${f.ids.incoming}`))).rejects.toThrow();
    const started = await f.begin(); expect((await f.events.api.deletionOwner!.run(started.context)).kind).toBe('done');
    await f.events.api.releaseHeld();
    await f.database.db.execute(sql`DELETE FROM events.subscriptions WHERE id=${f.ids.incoming}`);
    expect((await f.database.db.execute(sql`SELECT id FROM events.subscriptions WHERE id=${f.ids.foreignSubscription}`)).length).toBe(1);
    await expect(Promise.resolve(f.database.db.execute(sql`DELETE FROM events.subscriptions WHERE id=${f.ids.subscription}`))).rejects.toThrow();
  });
  test('无法识别的历史来源明确阻断，而不是遗漏出盘点结果',async () => {
    f = await eventsDeletionFixture(async (db) => {
      // 真正的旧库内容在升级前写入；升级后的普通写入已经拒绝无归属来源。
      await db.execute(sql`INSERT INTO events.event_types(id,name,state,event_type,producer_id,producer,producer_project) VALUES (${Bun.randomUUIDv7()},'unknown','active','unknown.type',${Bun.randomUUIDv7()},'unknown-producer','unknown-project')`);
    });
    const report = await f.events.api.deletionOwner!.inspect(await f.project.api.deletionScope(f.own.id));
    expect(report.complete).toBe(false); expect(report.blockers).toMatchObject([{ code: 'ownership-unresolved' }]);
  });
});
