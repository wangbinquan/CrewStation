import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { ProjectId, UserId } from '@crewstation/contracts';
import { jsonHash, newId } from '@crewstation/kernel';
import { runMigrations } from '@crewstation/persistence';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { identityMigrations } from '../wiring';
import { identityDeletionFixture } from './deletionFixture';

const available = await testDatabaseAvailable(); let db: TestDatabase, f: ReturnType<typeof identityDeletionFixture>, adminId: UserId;
const legacy = newId('legacy') as ProjectId;
beforeAll(async () => {
  if (!available) return;
  db = await createTestDatabase([{ ...identityMigrations, files: identityMigrations.files.filter((m) => !m.name.startsWith('0013_')) }]);
  await db.db.execute(sql`INSERT INTO identity.identity_forwarding(id,scope,project_id,fields) VALUES (${newId('forwarding')},'project',${legacy},'["email"]')`);
  await runMigrations(db.db, [identityMigrations]); f = identityDeletionFixture(db.db);
  const admin = await f.identity.api.ensureUser({ externalId: 'admin', name: 'Admin', email: 'admin@test.invalid' }); adminId = admin.id;
});
afterAll(async () => { await db?.drop(); });
const actor = () => ({ userId: adminId, isAdmin: true, authMethod: 'oidc' as const });
const sourceRequest = (ip: string) => ({ host: 'api.cs.localhost', forwardedFor: ip, method: 'POST', uri: '/v1/tasks' });
describe.skipIf(!available)('项目身份清理与准入（真实 PG／JWT）', () => {
  test('升级保留旧身份转发；盘点只包含本项目覆盖，不改用户、全局转发或签名钥', async () => {
    const setup = await f.make(legacy, 'identity-legacy'); expect(setup.grant.confirmed.resources[0]?.count).toBe(1);
    expect(await f.identity.api.effectiveForwarding(legacy)).toMatchObject({ fields: ['email'], source: 'project' });
    const before = await db.db.execute('SELECT id,scope,fields FROM identity.identity_forwarding WHERE project_id IS NULL');
    const users = await f.identity.api.listUsers(); await f.allPhases(setup);
    expect(await db.db.execute('SELECT id,scope,fields FROM identity.identity_forwarding WHERE project_id IS NULL')).toEqual(before);
    expect(await f.identity.api.listUsers()).toEqual(users);
    expect((await setup.owner.inspect(setup.target)).resources[0]?.count).toBe(0);
  });
  test('受理事实立即关新签发与原开发／服务／开发来源 JWT；独立 auth 实例读同一持久墓碑', async () => {
    const setup = await f.make(), { taskId, service, dev } = f.sources(setup.target.slug);
    const credential = await f.credential(setup, adminId, taskId);
    expect(await f.identity.api.resolveDevSessionToken(credential.token)).toBeDefined();
    const issuedService = await f.identity.api.authorizeServiceRequest(sourceRequest('10.0.0.1'));
    const issuedDev = await f.identity.api.authorizeServiceRequest(sourceRequest('10.0.0.2'));
    expect(issuedService.kind).toBe('allow'); expect(issuedDev.kind).toBe('allow');
    if (issuedService.kind !== 'allow' || issuedDev.kind !== 'allow') throw new Error('expected source tokens');
    expect(await f.identity.api.resolveServiceSource(issuedService.injected.sourceToken)).toEqual(service);
    expect(await f.identity.api.resolveDevelopmentSource(issuedDev.injected.sourceToken)).toEqual(dev);
    f.closed.add(setup.target.id);
    await expect(f.credential(setup, adminId, taskId)).rejects.toMatchObject({ kind: 'precondition' });
    expect(await f.identity.api.resolveDevSessionToken(credential.token)).toBeUndefined();
    expect(await f.identity.api.resolveServiceSource(issuedService.injected.sourceToken)).toBeUndefined();
    expect(await f.identity.api.resolveDevelopmentSource(issuedDev.injected.sourceToken)).toBeUndefined();
    expect(await f.identity.api.authorizeServiceRequest(sourceRequest('10.0.0.1'))).toMatchObject({ kind: 'forbidden', reason: 'project-deleting' });
    expect((await setup.run('seal')).kind).toBe('done'); f.closed.delete(setup.target.id);
    const restarted = identityDeletionFixture(db.db); restarted.ids.set(setup.target.slug, setup.target.id); restarted.sources(setup.target.slug);
    expect(await restarted.identity.api.resolveDevSessionToken(credential.token)).toBeUndefined();
    expect(await restarted.identity.api.resolveServiceSource(issuedService.injected.sourceToken)).toBeUndefined();
    expect(await restarted.identity.api.authorizeServiceRequest(sourceRequest('10.0.0.1'))).toMatchObject({ kind: 'forbidden' });
    f.ids.delete(setup.target.slug);
    expect(await f.identity.api.authorizeServiceRequest(sourceRequest('10.0.0.1'))).toMatchObject({ kind: 'forbidden' });
    expect(await f.identity.api.getUser(adminId)).toBeDefined(); expect((await f.identity.api.jwks()).keys.length).toBeGreaterThan(0);
  });
  test('迟到转发写入、删除及转移项目均被本 schema 屏障拒绝；其他项目和全局仍可配置', async () => {
    const id = newId('project') as ProjectId, other = newId('other') as ProjectId;
    await f.identity.api.setProjectForwarding(actor(), id, { fields: ['name'] }); const setup = await f.make(id, 'identity-write');
    expect((await setup.run('seal')).kind).toBe('done');
    await expect(f.identity.api.setProjectForwarding(actor(), id, { fields: ['email'] })).rejects.toMatchObject({ kind: 'precondition' });
    await expect(f.identity.api.clearProjectForwarding(actor(), id)).rejects.toMatchObject({ kind: 'precondition' });
    for (const query of [sql`UPDATE identity.identity_forwarding SET fields = '[]' WHERE project_id = ${id}`, sql`DELETE FROM identity.identity_forwarding WHERE project_id = ${id}`,
      sql`UPDATE identity.identity_forwarding SET project_id = ${other} WHERE project_id = ${id}`]) await expect(Promise.resolve(db.db.execute(query))).rejects.toMatchObject({ cause: { message: 'project identity is sealed for deletion' } });
    await f.identity.api.setProjectForwarding(actor(), other, { fields: ['email'] });
    await f.identity.api.setGlobalForwarding(actor(), { fields: ['name', 'email'] });
    await f.allPhases(setup); expect((await setup.owner.inspect(setup.target)).resources[0]?.count).toBe(0);
    expect(await f.identity.api.effectiveForwarding(other)).toMatchObject({ fields: ['email'] });
    await expect(f.identity.api.effectiveForwarding(id)).rejects.toMatchObject({ kind: 'precondition' });
    await expect(Promise.resolve(db.db.execute(sql`INSERT INTO identity.identity_forwarding(id,scope,project_id,fields) VALUES (${newId('late')},'project',${id},'[]')`))).rejects.toMatchObject({ cause: { message: 'project identity is sealed for deletion' } });
  });
  test('确认范围变化／错误来源／失效旧世代阻断；源查询失败不返回空成功', async () => {
    const id = newId('project') as ProjectId, setup = await f.make(id, 'identity-change');
    await f.identity.api.setProjectForwarding(actor(), id, { fields: ['name'] });
    expect(await setup.run('seal')).toMatchObject({ kind: 'blocked', blockers: [{ code: 'inventory-changed' }] });
    const old = setup.context(); setup.grant.generation++; expect((await setup.run('seal')).kind).toBe('blocked');
    await expect(setup.owner.run(old)).rejects.toMatchObject({ kind: 'precondition' });
    setup.grant.valid = false; await expect(setup.run('metadata')).rejects.toMatchObject({ kind: 'precondition' });
    expect(jsonHash(await setup.owner.inspect(setup.target))).not.toBe(jsonHash(setup.grant.confirmed));
    await db.db.execute('CREATE TABLE identity.unknown_project_content(project_id text)');
    try { await expect(setup.owner.inspect(setup.target)).rejects.toMatchObject({ kind: 'precondition' }); }
    finally { await db.db.execute('DROP TABLE identity.unknown_project_content'); }
  });
});
