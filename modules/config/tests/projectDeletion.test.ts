import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { BUILTIN_RESOURCES, PROJECT_DELETION_PARTICIPANTS, PROJECT_DELETION_PHASES } from '@crewstation/contracts';
import type { Actor, ProjectDeletionContext, ProjectDeletionInventory, ProjectDeletionPhase, ProjectId } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { createIdentityModule, identityMigrations } from '@crewstation/module-identity';
import { createProjectModule, projectMigrations } from '@crewstation/module-project';
import type { ProjectModule } from '@crewstation/module-project';
import { jsonHash, newId } from '@crewstation/kernel';
import { runMigrations } from '@crewstation/persistence';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { configMigrations, createConfigModule } from '../wiring';
import type { ConfigModule } from '../wiring';

const available = await testDatabaseAvailable(); let db: TestDatabase, project: ProjectModule, config: ConfigModule, admin: Actor;
let sequence = 0, offset = 0, legacy: ProjectId;
const make = async () => (await project.api.createProject(admin, { slug: `delete-config-${++sequence}`, name: '配置清理', kind: 'DigitalWorker', template: BUILTIN_RESOURCES.minimalTemplate })).id;
const write = (id: ProjectId, value: string) => config.api.createItem(admin, id, { name: `SECRET_${++sequence}`, bindingName: `SECRET_${sequence}`, env: 'production', isSecret: true, value });
async function begin(id: ProjectId) {
  const target = await project.api.deletionScope(id), own = await config.api.deletionOwner!.inspect(target), metadata = await project.api.inspectProjectDeletionMetadata(id);
  const reports: ProjectDeletionInventory[] = PROJECT_DELETION_PARTICIPANTS.map((participant) => participant === 'config' ? own : participant === 'project' ? metadata : { participant, revision: jsonHash(participant), complete: true, resources: [], references: [], blockers: [] });
  const plan = await project.api.prepareDeletionPlan(admin, id, reports);
  const operation = await project.api.acceptProjectDeletion(admin, id, { planId: plan.id, requestKey: newId('request'), confirm: 'delete' }, reports);
  const claimed = (await project.api.claimProjectDeletion(operation.id, 'config-test'))!;
  return { operation, lease: claimed.lease, context: { operationId: operation.id, generation: claimed.lease.generation, target: plan.target, confirmed: plan.participants.find((r) => r.participant === 'config')!, phase: 'seal' as ProjectDeletionPhase }, plan };
}
beforeAll(async () => {
  if (!available) return;
  db = await createTestDatabase([eventbusMigrations, identityMigrations, projectMigrations, { ...configMigrations, files: configMigrations.files.filter((f) => !f.name.startsWith('0005_')) }]);
  const identity = createIdentityModule({ db: db.db, settings: { adminEmails: [] } });
  const user = await identity.api.ensureUser({ externalId: 'admin', name: 'Admin', email: 'admin@test.invalid' }); admin = { userId: user.id, isAdmin: true };
  project = createProjectModule({ db: db.db, identity: identity.api, clock: { now: () => new Date(Date.now() + offset) },
    hosts: { prodHost: (s) => `${s}.test`, previewHost: (s) => `preview.${s}.test`, serviceHost: (s) => `${s}.service.test` },
    settings: { defaultServicePlan: BUILTIN_RESOURCES.servicePlanSmall, defaultMaxConcurrentTasks: 3 } });
  config = createConfigModule({ db: db.db, project: project.api, settings: { secretKeyBase64: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64') } });
  legacy = await make(); await write(legacy, 'legacy-secret'); await runMigrations(db.db, [configMigrations]);
});
afterAll(async () => { await db?.drop(); });
describe.skipIf(!available)('配置所有者永久清理（真实 PG）', () => {
  test('旧库迁移不丢原配置，盘点包含历史 Secret 且不泄露密文／原文', async () => {
    expect(await config.api.renderEnv(legacy, 'production')).toEqual({ SECRET_2: 'legacy-secret' });
    const report = await config.api.deletionOwner!.inspect(await project.api.deletionScope(legacy));
    expect(report.complete).toBe(true); expect(report.resources.map((r) => r.kind)).toEqual(['version_entries', 'versions', 'items', 'definitions', 'value_sets']);
    expect(report.resources.find((r) => r.kind === 'version_entries')?.count).toBe(1);
    expect(JSON.stringify(report)).not.toContain('legacy-secret'); expect(JSON.stringify(report)).not.toContain('v1:');
  });
  test('受理后内部模板初始化和配置渲染停止；seal 同时阻止迟到 SQL、历史写入和转移项目逃过屏障', async () => {
    const id = await make(), other = await make(); await write(id, 'sealed-secret');
    const started = await begin(id), result = await config.api.deletionOwner!.run(started.context); expect(result.kind).toBe('done');
    await expect(config.api.ensureTemplateDefinition(id, { id: newId('definition'), name: 'LATE', bindingName: 'LATE' })).rejects.toMatchObject({ kind: 'precondition' });
    await expect(config.api.renderEnv(id, 'production')).rejects.toMatchObject({ kind: 'precondition' });
    await expect(config.api.renderDefinitions(id, 'production')).rejects.toMatchObject({ kind: 'precondition' });
    await expect(config.api.renderPinnedSecretDefinitions(id, 'production', [])).rejects.toMatchObject({ kind: 'precondition' });
    for (const query of [sql`UPDATE config.items SET value = 'late' WHERE project_id = ${id}`, sql`DELETE FROM config.version_entries WHERE project_id = ${id}`,
      sql`UPDATE config.definitions SET project_id = ${other} WHERE project_id = ${id}`, sql`INSERT INTO config.versions VALUES (${id},'production',999,${admin.userId},now())`]) {
      await expect(Promise.resolve(db.db.execute(query))).rejects.toMatchObject({ cause: { message: 'project configuration is sealed for deletion' } });
    }
    expect((await config.api.deletionOwner!.inspect(started.context.target)).revision).toBe(started.context.confirmed.revision);
    await expect(config.api.deletionOwner!.run({ ...started.context, phase: 'metadata' })).rejects.toMatchObject({ kind: 'precondition' });
  });
  test('确认后内容改变会封住写入并阻断，不用空回执掩盖额外快照；错误 owner／旧世代不能清理', async () => {
    const id = await make(); await write(id, 'original'); const started = await begin(id);
    await db.db.execute(sql`UPDATE config.items SET value = 'late-snapshot' WHERE project_id = ${id}`);
    expect(await config.api.deletionOwner!.run(started.context)).toMatchObject({ kind: 'blocked', blockers: [{ code: 'inventory-changed' }] });
    await expect(Promise.resolve(db.db.execute(sql`UPDATE config.items SET value = 'later' WHERE project_id = ${id}`))).rejects.toMatchObject({ cause: { message: 'project configuration is sealed for deletion' } });
    const context: ProjectDeletionContext = { ...started.context, confirmed: started.plan.participants.find((r) => r.participant === 'scm')! };
    await expect(config.api.deletionOwner!.run(context)).rejects.toMatchObject({ kind: 'precondition' });
    offset += 120_001; await project.api.claimProjectDeletion(started.operation.id, 'new-owner');
    await expect(config.api.deletionOwner!.run(started.context)).rejects.toMatchObject({ kind: 'precondition' });
  });
  test('全部先前证明后清掉每个历史快照，重复清理稳定，其他项目保留；根删除后墓碑拦住旧键复活', async () => {
    const id = await make(), other = await make(); const item = await write(id, 'delete-me'), shared = await write(other, 'keep-me');
    await db.db.execute(sql`INSERT INTO config.version_entries(project_id,env,version,name,is_secret,value,item_id,definition_id,binding_name)
      SELECT ${id},'production',n,${item.name},true,'historic-cipher',${item.id},${item.definitionId},${item.bindingName} FROM generate_series(2,1502) n`);
    const started = await begin(id); expect(started.context.confirmed.resources.find((r) => r.kind === 'version_entries')?.count).toBe(1502);
    for (const phase of PROJECT_DELETION_PHASES) for (const participant of PROJECT_DELETION_PARTICIPANTS) {
      const context = { ...started.context, phase, confirmed: started.plan.participants.find((r) => r.participant === participant)! };
      const owner = participant === 'config' ? config.api.deletionOwner : participant === 'project' ? project.api.deletionOwner : undefined;
      const step = owner ? await owner.run(context) : { kind: 'done' as const, evidence: { kind: 'not-applicable' as const, digest: jsonHash({ participant, phase }), description: '其他 owner 空范围的模块测试占位证明', count: 0 } };
      expect(step.kind).toBe('done'); if (step.kind !== 'done') throw new Error('module cleanup failed');
      if (participant === 'config' && phase === 'metadata') expect(await owner!.run(context)).toEqual(step);
      await project.api.recordProjectDeletionReceipt(started.lease, participant, phase, step.evidence);
    }
    expect((await project.api.completeProjectDeletion(started.lease)).state).toBe('succeeded');
    expect((await config.api.deletionOwner!.inspect(started.context.target)).resources.every((r) => r.count === 0)).toBe(true);
    expect(await config.api.renderEnv(other, 'production')).toEqual({ [shared.name]: 'keep-me' });
    await expect(Promise.resolve(db.db.execute(sql`INSERT INTO config.value_sets VALUES (${id},'production',1,now())`))).rejects.toMatchObject({ cause: { message: 'project configuration is sealed for deletion' } });
    expect(await db.db.execute(sql`SELECT project_id,operation_id FROM config.deletion_fences WHERE project_id = ${id}`)).toMatchObject([{ project_id: id, operation_id: started.operation.id }]);
  });
  test('新项目内容表遗漏登记时拒绝空盘点／成功证明', async () => {
    const id = await make(); await db.db.execute('CREATE TABLE config.unknown_content(project_id text)');
    try { await expect(config.api.deletionOwner!.inspect(await project.api.deletionScope(id))).rejects.toMatchObject({ kind: 'precondition' }); }
    finally { await db.db.execute('DROP TABLE config.unknown_content'); }
  });
});
