import { afterEach, describe, expect, test } from 'bun:test';
import type { ProjectDeletionTarget, ProjectId, ReleaseId, ServiceId } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { eventbusMigrations } from '@crewstation/eventbus';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { runMigrations } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { releaseProjectContent } from '../adapters/persistence/projectContent';
import { drizzleUnitOfWork } from '../adapters/persistence/drizzleUnitOfWork';
import type { Release } from '../domain/release';
import { initialSlots } from '../domain/slots';
import type { ReleaseContentDirectory } from '../ports/repositories';
import { releaseMigrations } from '../wiring';
import { releaseImageFixture } from './runtimeImageFixture';

const available = await testDatabaseAvailable();
const fixtures: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(async () => { for (const tdb of fixtures.splice(0)) await tdb.drop(); });
async function setup(identities?: ReleaseContentDirectory, previous = false) {
  const migrations = previous ? { ...releaseMigrations, files: releaseMigrations.files.filter((file) => file.name < '0009') } : releaseMigrations;
  const tdb = await createTestDatabase([eventbusMigrations, migrations]); fixtures.push(tdb);
  const db = tdb.db, uow = drizzleUnitOfWork(db);
  const project = newResourceId() as ProjectId, service = newResourceId() as ServiceId;
  const otherProject = newResourceId() as ProjectId, otherService = newResourceId() as ServiceId;
  const target: ProjectDeletionTarget = { id: project, serviceId: service, slug: 'deletion', name: 'Deletion', namespace: 'cs-deletion', kind: 'DigitalWorker', state: 'active', revision: '1', prodHost: 'deletion.test', previewHost: 'preview.deletion.test', serviceHost: 'svc.deletion.test' };
  const services = { resolveServiceById: async (id: ServiceId) => id === service || id === otherService ? { projectId: id === service ? project : otherProject, slug: 'deletion', name: 'deletion', namespace: 'cs-deletion' } : undefined };
  const read = releaseProjectContent({ db, services, identities });
  const record = (foreign = false): Release => ({ id: newResourceId() as ReleaseId, projectId: foreign ? otherProject : project, serviceId: foreign ? otherService : service, tag: 'v0.0.1', commitSha: 'c'.repeat(40), branch: 'main', status: 'failed', targetSlot: 'green', pipeline: { step: 1 }, createdBy: newResourceId() as Release['createdBy'], createdAt: new Date('2026-10-01T00:00:00Z'), updatedAt: new Date('2026-10-01T00:00:00Z') });
  return { db, uow, project, service, otherProject, otherService, target, services, read, record, upgrade: () => runMigrations(db, [releaseMigrations]) };
}
const count = (value: Pick<Awaited<ReturnType<ReturnType<typeof releaseProjectContent>>>, 'inventory'>, kind: string) => value.inventory.resources.find((row) => row.kind === kind)?.count ?? 0;

describe.skipIf(!available)('发布完整保留内容来源', () => {
  test('七类本项目内容均纳入，失败发布与两个槽保留原输入摘要；外项目和全局策略保持，秘密不出来源', async () => {
    const f = await setup(), own = f.record(), foreign = f.record(true);
    await f.uow.read.releases.insert(own); await f.uow.read.releases.insert(foreign);
    await f.uow.read.slots.initialize(initialSlots(f.service, new Date())); await f.uow.read.slots.initialize(initialSlots(f.otherService, new Date()));
    await f.uow.read.switches.insert({ id: newResourceId(), serviceId: f.service, fromSlot: 'prod', toSlot: 'preview', releaseId: own.id, actorUserId: own.createdBy, createdAt: own.createdAt });
    await f.uow.read.slotEvents.insert({ id: newResourceId(), serviceId: f.service, kind: 'offline', releaseId: own.id, tag: own.tag, at: own.createdAt });
    await f.uow.read.maintenance.setOverride(f.service, 'green', 2);
    await f.db.execute(sql`INSERT INTO release.slot_maintenance(id,service_id,state,body,legacy_body) VALUES(${newResourceId()},${f.service},'finished',${JSON.stringify({ private: 'do-not-export', operation: { target: { projectId: f.project, serviceId: f.service, releaseId: own.id } } })}::jsonb,'{"oldSecret":"do-not-export"}'::jsonb)`);
    await f.db.execute(sql`INSERT INTO release.execution_handoffs(id,request_key,service_id,stage,body) VALUES(${newResourceId()},${newResourceId()},${f.service},'complete',${JSON.stringify({ projectId: f.project, serviceId: f.service, targetReleaseId: own.id, private: 'do-not-export' })}::jsonb)`);
    await f.uow.read.offlinePolicy.save({ rollbackRetentionHours: 72, idleOfflineDays: 14, reminderLeadHours: 24, revision: 1, updatedAt: new Date() }, 0);
    const result = await f.read(f.target);
    expect(result.inventory.complete).toBe(true); expect(result.inventory.blockers).toEqual([]);
    for (const kind of ['releases', 'service_slots', 'traffic_switches', 'replica_overrides', 'slot_events', 'slot_maintenance', 'execution_handoffs']) expect(count(result, kind)).toBe(1);
    expect(result.rows).toHaveLength(7); expect(result.consumers).toHaveLength(5);
    expect(result.consumers.find((entry) => entry.kind === 'release')).toMatchObject({ id: own.id, state: 'failed', aliases: [own.id] });
    expect(result.rows.every((row) => /^[a-f0-9]{64}$/.test(row.identity))).toBe(true);
    expect(JSON.stringify(result)).not.toContain('do-not-export'); expect(JSON.stringify(result)).not.toContain(foreign.id);
    expect((await f.db.execute(sql`SELECT count(*)::int AS count FROM release.releases`))[0]!.count).toBe(2);
    expect((await f.uow.read.offlinePolicy.get())?.revision).toBe(1);
  });

  test('空开通和全局策略只证明元数据来源为空，不伪造实际消费者退出或字节回收', async () => {
    const f = await setup();
    const result = await f.read(f.target);
    expect(result.inventory.complete).toBe(true); expect(result.inventory.resources).toEqual([]);
    expect(result.rows).toEqual([]); expect(result.consumers).toEqual([]);
    expect(result).not.toHaveProperty('physicalReclaimed');
  });

  test('模块公开的内部来源读同一完整实现，不开放额外 HTTP 写入', async () => {
    const f = await releaseImageFixture();
    try {
      const target: ProjectDeletionTarget = { id: f.projectId, serviceId: f.serviceId, slug: 'image', name: 'Image', namespace: 'cs-image', kind: 'DigitalWorker', state: 'active', revision: '1', prodHost: 'image.test', previewHost: 'preview.image.test', serviceHost: 'svc.image.test' };
      const created = await f.runtime.api.publish(f.actor, f.serviceId, { branch: 'main', version: 'patch' });
      const result = await f.runtime.api.deletionContent(target);
      expect(result.inventory.complete).toBe(true); expect(count(result, 'releases')).toBe(1); expect(count(result, 'service_slots')).toBe(1);
      expect(result.consumers.find((entry) => entry.kind === 'release')?.id).toBe(created.id);
      expect(result.inventory.resources.every((entry) => entry.scope === 'metadata')).toBe(true);
    } finally { await f.close(); }
  });

  test('两千条不同历史发布全量盘点，工作台的列表页和状态不限制范围', async () => {
    const f = await setup(), base = f.record();
    const values = Array.from({ length: 2002 }, (_, i) => ({ id: newResourceId(), tag: `v0.${i}.0`, status: ['failed', 'offline', 'superseded', 'ready'][i % 4] }));
    await f.db.execute(sql`INSERT INTO release.releases(id,service_id,project_id,tag,commit_sha,branch,status,target_slot,pipeline,created_by,created_at,updated_at)
      SELECT value->>'id',${f.service},${f.project},value->>'tag',${base.commitSha},'main',value->>'status','green','{"step":1}'::jsonb,${base.createdBy},now(),now()
      FROM jsonb_array_elements(${JSON.stringify(values)}::jsonb) AS value`);
    await f.uow.read.releases.insert(f.record(true));
    const result = await f.read(f.target);
    expect(result.inventory.complete).toBe(true); expect(count(result, 'releases')).toBe(2002);
    expect(result.rows).toHaveLength(2002); expect(result.consumers).toHaveLength(2002);
    expect(new Set(result.rows.map((row) => row.key)).size).toBe(2002);
  }, 15_000);

  test('旧项目／服务／发布 ID 和空当前快照仍绑定原项目；读取结果不泄露旧内容', async () => {
    const f = await setup(undefined, true), own = f.record();
    await f.uow.read.releases.insert({ ...own, legacyResourceId: 'rel_old' });
    for (const [kind, key, id] of [['project', 'proj_old', f.project], ['service', 'svc_old', f.service], ['release', 'rel_old', own.id]]) {
      await f.db.execute(sql`INSERT INTO release.resource_identity_aliases(kind,key,id) VALUES(${kind},${JSON.stringify([key])},${id})`);
    }
    await f.db.execute(sql`UPDATE release.releases SET project_id='proj_old',service_id='svc_old' WHERE id=${own.id}`);
    await f.db.execute(sql`INSERT INTO release.slot_maintenance(id,service_id,state,body,legacy_body) VALUES(${newResourceId()},'svc_old','finished','{}'::jsonb,${JSON.stringify({ operation: { target: { projectId: 'proj_old', serviceId: 'svc_old', releaseId: 'rel_old' } }, old: 'never-return' })}::jsonb)`);
    await f.upgrade();
    const result = await f.read(f.target);
    expect(result.inventory.complete).toBe(true); expect(count(result, 'releases')).toBe(1); expect(count(result, 'slot_maintenance')).toBe(1);
    expect(result.consumers.find((entry) => entry.kind === 'release')?.aliases).toEqual([own.id, 'rel_old'].sort());
    expect(JSON.stringify(result)).not.toContain('never-return');
  });

  test('外项目当前行和原项目旧快照的反向冲突阻断，不能只按旧 body 认领当前行', async () => {
    const f = await setup();
    await f.db.execute(sql`INSERT INTO release.slot_maintenance(id,service_id,state,body,legacy_body) VALUES(${newResourceId()},${f.otherService},'finished',${JSON.stringify({ operation: { target: { projectId: f.otherProject } } })}::jsonb,${JSON.stringify({ nested: { original: { projectId: f.project } } })}::jsonb)`);
    const result = await f.read(f.target);
    expect(result.inventory.complete).toBe(false); expect(result.inventory.blockers.map((entry) => entry.code)).toContain('release-ownership-conflict');
    expect(count(result, 'slot_maintenance')).toBe(0);
    expect((await f.db.execute(sql`SELECT count(*)::int AS count FROM release.slot_maintenance`))[0]!.count).toBe(1);
  });

  test('其他项目槽仍引用原项目发布时，报告外部引用且不把外项目记录放入可清范围', async () => {
    const f = await setup(), own = f.record(); await f.uow.read.releases.insert(own);
    const slots = initialSlots(f.otherService, new Date());
    await f.uow.read.slots.initialize({ ...slots, blue: { ...slots.blue, releaseId: own.id } });
    const result = await f.read(f.target);
    expect(result.inventory.complete).toBe(false); expect(result.inventory.references).toEqual([expect.objectContaining({ kind: 'service_slots', projectId: f.otherProject })]);
    expect(count(result, 'releases')).toBe(1); expect(count(result, 'service_slots')).toBe(0);
  });

  test('缺失原发布和归属不明的服务分别阻断，不能用查无历史替代来源完整', async () => {
    const f = await setup(), slots = initialSlots(f.service, new Date());
    await f.uow.read.slots.initialize({ ...slots, green: { ...slots.green, releaseId: newResourceId() as ReleaseId } });
    await f.uow.read.maintenance.setOverride(newResourceId(), 'green', 1);
    const result = await f.read(f.target), codes = result.inventory.blockers.map((entry) => entry.code);
    expect(result.inventory.complete).toBe(false); expect(codes).toContain('release-reference-source-missing'); expect(codes).toContain('release-orphan-content');
  });

  test('目录和保留记录的旧 ID 相互冲突，不能让后读到的映射覆盖前一个原身份', async () => {
    const mappings = new Map<string, string>();
    const identities: ReleaseContentDirectory = { aliases: async (kind, id) => [...mappings].filter(([key, value]) => key.startsWith(kind + ':') && value === id).map(([key]) => [key.slice(kind.length + 1)]), resolve: async (kind, keys) => mappings.get(kind + ':' + keys[0]) };
    const f = await setup(identities, true), own = f.record(); await f.uow.read.releases.insert(own);
    await f.db.execute(sql`INSERT INTO release.resource_identity_aliases(kind,key,id) VALUES('project','["proj_old"]',${f.otherProject})`);
    mappings.set('project:proj_old', f.project);
    await f.db.execute(sql`UPDATE release.releases SET project_id='proj_old' WHERE id=${own.id}`);
    await f.upgrade();
    const result = await f.read(f.target);
    expect(result.inventory.complete).toBe(false); expect(result.inventory.blockers.map((entry) => entry.code)).toContain('release-identity-conflict');
  });

  test('复合原标识完整保留并进入确认摘要，其他项目新增别名不会改变本项目范围', async () => {
    const f = await setup(), own = f.record(); await f.uow.read.releases.insert(own);
    const before = await f.read(f.target), key = JSON.stringify(['old-project', 'old-release']);
    await f.db.execute(sql`INSERT INTO release.resource_identity_aliases(kind,key,id) VALUES('release',${key},${own.id})`);
    const after = await f.read(f.target);
    expect(after.inventory.complete).toBe(true); expect(after.inventory.revision).not.toBe(before.inventory.revision);
    expect(after.identityLinks).toContainEqual({ kind: 'release', keys: ['old-project', 'old-release'], id: own.id });
    expect(after.consumers[0]!.aliases).not.toContain('old-project');
    await f.db.execute(sql`INSERT INTO release.resource_identity_aliases(kind,key,id) VALUES('release','["foreign-alias"]',${newResourceId()})`);
    expect((await f.read(f.target)).inventory.revision).toBe(after.inventory.revision);
  });

  test('原 UUID 的目录冲突、缺少原项目、不可解析服务和项目标识均阻断', async () => {
    const f = await setup(undefined, true), own = f.record(); await f.uow.read.releases.insert(own);
    await f.db.execute(sql`INSERT INTO release.resource_identity_aliases(kind,key,id) VALUES('release',${JSON.stringify([own.id])},${newResourceId()})`);
    await f.db.execute(sql`UPDATE release.releases SET project_id='',service_id='unmapped-service'`);
    await f.upgrade();
    const result = await f.read(f.target), codes = result.inventory.blockers.map((entry) => entry.code);
    expect(result.inventory.complete).toBe(false); expect(codes).toContain('release-identity-conflict'); expect(codes).toContain('release-record-invalid'); expect(codes).toContain('release-service-source-missing');
    const unknown = await setup(undefined, true), retained = unknown.record(); await unknown.uow.read.releases.insert(retained);
    await unknown.db.execute(sql`UPDATE release.releases SET project_id='unmapped-project'`); await unknown.upgrade();
    expect((await unknown.read(unknown.target)).inventory.blockers.map((entry) => entry.code)).toContain('release-project-source-missing');
  });

  test('上游不可读不返回空成功；坏项目身份也不能作为外项目被静默排除', async () => {
    const f = await setup(); await f.uow.read.maintenance.setOverride(f.service, 'green', 1);
    const failed = releaseProjectContent({ db: f.db, services: { resolveServiceById: async () => { throw new Error('source unavailable'); } } });
    await expect(failed(f.target)).rejects.toThrow('source unavailable');
    const bad = releaseProjectContent({ db: f.db, services: { resolveServiceById: async () => ({ projectId: 'invalid' as ProjectId, slug: 'test', name: 'test', namespace: 'cs-test' }) } });
    expect((await bad(f.target)).inventory.blockers.map((entry) => entry.code)).toContain('release-service-source-missing');
    await expect(f.read({ ...f.target, id: 'bad' as ProjectId })).rejects.toThrow();
  });

  test('空未知表或未知列也阻断，已知数据不能掩盖新存储面', async () => {
    const f = await setup(); await f.uow.read.releases.insert(f.record());
    await f.db.execute(sql`CREATE TABLE release.future_payload(id text PRIMARY KEY,private_body text)`);
    expect((await f.read(f.target)).inventory.blockers.map((entry) => entry.code)).toContain('release-schema-incomplete');
    await f.db.execute(sql`DROP TABLE release.future_payload`);
    await f.db.execute(sql`ALTER TABLE release.releases ADD COLUMN future_secret text`);
    expect((await f.read(f.target)).inventory.complete).toBe(false);
  });

  test('坏旧标识、未知全局策略和缺少原 UUID 的记录均保守阻断', async () => {
    const f = await setup(undefined, true); await f.uow.read.releases.insert(f.record());
    await f.db.execute(sql`UPDATE release.releases SET id='rel_unmapped'`);
    await f.db.execute(sql`INSERT INTO release.resource_identity_aliases(kind,key,id) VALUES('release','bad-json',${newResourceId()}),('release','[]','bad-id')`);
    await f.db.execute(sql`INSERT INTO release.offline_policy VALUES('unknown',72,14,24,1,NULL,now())`);
    await f.upgrade();
    const codes = (await f.read(f.target)).inventory.blockers.map((entry) => entry.code);
    expect(codes).toContain('release-alias-invalid'); expect(codes).toContain('release-record-invalid'); expect(codes).toContain('release-global-policy-invalid');
  });

  test('未变化内容修订稳定，秘密或流水线输入变化即变更确认摘要', async () => {
    const f = await setup(), own = f.record(); await f.uow.read.releases.insert(own);
    const before = await f.read(f.target); expect((await f.read(f.target)).inventory.revision).toBe(before.inventory.revision);
    await f.db.execute(sql`UPDATE release.releases SET pipeline='{"step":1,"private":"late-secret"}'::jsonb WHERE id=${own.id}`);
    const after = await f.read(f.target);
    expect(after.inventory.revision).not.toBe(before.inventory.revision); expect(after.rows[0]!.identity).not.toBe(before.rows[0]!.identity);
    expect(JSON.stringify(after)).not.toContain('late-secret');
  });
});
