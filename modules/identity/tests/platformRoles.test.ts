import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { ProjectId, UserId } from '@crewstation/contracts';
import { IDENTITY_HEADERS } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import { runMigrations } from '@crewstation/persistence';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { createIdentityModule, identityMigrations } from '../wiring';

const available = await testDatabaseAvailable();
let db: TestDatabase;
beforeAll(async () => { if (available) db = await createTestDatabase([identityMigrations]); });
afterAll(async () => { await db?.drop(); });

describe.skipIf(!available)('平台三角色与迁移（PostgreSQL）', () => {
  test('新用户为 user，CAS 冲突不写入，资料刷新保留角色，旧管理员接口复用约束', async () => {
    const identity = createIdentityModule({ db: db.db, settings: { adminEmails: ['admin@test.invalid'] } });
    const admin = await identity.api.ensureUser({ externalId: 'admin', name: 'Admin', email: 'admin@test.invalid' });
    const external = { externalId: 'member', name: 'Member', email: 'member@test.invalid' };
    const member = await identity.api.ensureUser(external);
    expect(member).toMatchObject({ platformRole: 'user', isAdmin: false });
    expect(await identity.api.setPlatformRole(member.id, { expectedRole: 'user', platformRole: 'developer' })).toMatchObject({ platformRole: 'developer', isAdmin: false });
    await expect(identity.api.setPlatformRole(member.id, { expectedRole: 'user', platformRole: 'admin' })).rejects.toMatchObject({ kind: 'conflict' });
    expect(await identity.api.ensureUser({ ...external, name: 'Renamed' })).toMatchObject({ name: 'Renamed', platformRole: 'developer' });
    await expect(identity.api.setAdmin(admin.id, false)).rejects.toMatchObject({ kind: 'precondition' });
    const app = createApp({ name: 'roles' }); for (const route of identity.http.users) app.route('/', route);
    const change = (actor: UserId, expectedRole = 'developer') => app.request(`/v1/users/${member.id}/platform-role`, { method: 'PUT', headers: { [IDENTITY_HEADERS.userId]: actor, 'content-type': 'application/json' }, body: JSON.stringify({ platformRole: 'admin', expectedRole }) });
    expect((await change(member.id)).status).toBe(403);
    expect((await change(admin.id, 'user')).status).toBe(409);
    expect(await (await change(admin.id)).json()).toMatchObject({ platformRole: 'admin', isAdmin: true });
  });

  test('并发撤销管理员只能成功一位；负责人降级提示转交对象', async () => {
    const isolated = await createTestDatabase([identityMigrations]);
    try {
      const owned = '01a0bf5d-8f4b-7aef-84b8-c458233bab22' as ProjectId;
      const identity = createIdentityModule({ db: isolated.db, settings: { adminEmails: ['two@test.invalid'] }, membershipLookup: { membershipsOf: async () => [{ projectId: owned, role: 'owner' }] } });
      const one = await identity.api.ensureUser({ externalId: 'one', name: 'One', email: 'one@test.invalid' });
      const two = await identity.api.ensureUser({ externalId: 'two', name: 'Two', email: 'two@test.invalid' });
      const result = await Promise.allSettled([one, two].map((user) => identity.api.setPlatformRole(user.id, { platformRole: 'developer', expectedRole: 'admin' })));
      expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const developer = (await identity.api.listUsers()).find((u) => u.platformRole === 'developer')!;
      await expect(identity.api.setAdmin(developer.id, false)).rejects.toMatchObject({ kind: 'precondition', details: { projectIds: [owned] } });
    } finally { await isolated.drop(); }
  });

  test('升级旧数据可中断重跑，历史开发成员转开发者；显式降级与新用户不被再提权', async () => {
    const legacy = await createTestDatabase([{ ...identityMigrations, files: identityMigrations.files.filter((f) => !f.name.startsWith('0010')) }]);
    try {
      const ids = ['a', 'b', 'c'].map((s) => `usr_${s.repeat(32)}` as UserId);
      for (const [index, id] of ids.entries()) await legacy.db.execute(sql`insert into identity.users (id, external_id, name, email, is_admin, created_at, last_login_at) values (${id}, ${id}, ${id}, ${id}, ${index === 0}, now(), now())`);
      await runMigrations(legacy.db, [identityMigrations]);
      let fail = true;
      const identity = createIdentityModule({ db: legacy.db, settings: { adminEmails: [] }, membershipLookup: { membershipsOf: async (id) => {
        if (id === ids[2] && fail) throw new Error('interrupted');
        return [{ projectId: '01a0bf5d-8f4b-7fcb-815b-e99537cac400' as ProjectId, role: id === ids[1] ? 'developer' : 'tester' }];
      } } });
      await expect(identity.api.initializePlatformRoles()).rejects.toThrow('interrupted');
      expect(await identity.api.getUser(ids[1]!)).toMatchObject({ platformRole: 'developer' });
      await identity.api.setPlatformRole(ids[1]!, { platformRole: 'user', expectedRole: 'developer' });
      fail = false; expect(await identity.api.initializePlatformRoles()).toEqual({ initialized: 1 });
      expect((await identity.api.listUsers()).map((u) => u.platformRole).sort()).toEqual(['admin', 'user', 'user']);
      expect(await identity.api.initializePlatformRoles()).toEqual({ initialized: 0 });
      expect(await identity.api.ensureUser({ externalId: 'new', name: 'New', email: 'new@test.invalid' })).toMatchObject({ platformRole: 'user' });
    } finally { await legacy.drop(); }
  });
});
