import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Actor, UserId } from '@crewstation/contracts';
import { IDENTITY_HEADERS } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import { createFakeK8sClient } from '@crewstation/k8s';
import { noopLogger } from '@crewstation/kernel';
import { runMigrations } from '@crewstation/persistence';
import { loadPlatformSettings } from '@crewstation/settings';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { PlatformModule } from '../wiring';
import { createPlatformModule } from '../wiring';

const available = await testDatabaseAvailable();
let db: TestDatabase, platform: PlatformModule;
beforeAll(async () => {
  if (!available) return;
  db = await createTestDatabase();
  const settings = loadPlatformSettings({ CS_DATABASE_URL: db.url, CS_SECRET_KEY: Buffer.alloc(32, 2).toString('base64'), CS_GITLAB_URL: 'http://127.0.0.1:9' });
  platform = createPlatformModule({ db: db.db, settings, k8s: createFakeK8sClient(), logger: noopLogger, instance: 'test.role-home' });
  await runMigrations(db.db, platform.api.migrations);
});
afterAll(async () => { await db?.drop(); });

describe.skipIf(!available)('平台角色首页装配（真实数据库与 HTTP）', () => {
  test('默认模板目录可用于自建，只有负责人或管理员可重试开通失败项目', async () => {
    const { identity, project } = platform.modules;
    const adminUser = await identity.api.ensureUser({ externalId: 'admin', name: 'Admin', email: 'admin@role.test' });
    const admin: Actor = { userId: adminUser.id, isAdmin: true };
    const users = await Promise.all(['owner', 'developer', 'tester'].map((name) => identity.api.ensureUser({ externalId: name, name, email: `${name}@role.test` })));
    for (const user of users.slice(0, 2)) await identity.api.setPlatformRole(user.id, { platformRole: 'developer', expectedRole: 'user' });
    const owner: Actor = { userId: users[0]!.id, isAdmin: false };
    await project.api.updateServicePlan(admin, '01a0bf5d-8f4b-7000-9e4b-b54e91ee9d10', { name: 'standard-small', cpu: '1', memory: '1Gi', maxReplicas: 1, description: '' });
    expect(await platform.api.initializePlatformRoles()).toEqual({ initialized: 0 });
    const catalog = await project.api.creationCatalog(owner);
    expect(catalog.templates.some((template) => template.name === 'minimal-sample')).toBe(true);
    const app = createApp({ name: 'role-home' }); for (const route of platform.api.routers.api) app.route('/', route);
    const call = (id: UserId, path: string, method = 'GET') => app.request(path, { method, headers: { [IDENTITY_HEADERS.userId]: id } });
    const p = await project.api.createProject(owner, { name: '开发者的应用', slug: 'role-home', kind: 'DigitalWorker', template: '01a0bf5d-8f4b-7002-9560-94caf593fb19' });
    expect(p.ownerUserId).toBe(owner.userId);
    await project.api.setMember(owner, p.id, { userId: users[1]!.id, role: 'developer' });
    await project.api.setMember(owner, p.id, { userId: users[2]!.id, role: 'tester' });
    expect((await call(owner.userId, `/v1/projects/${p.id}/provision`, 'POST')).status).toBe(412);
    await project.api.setProjectState(p.id, 'failed', '模拟模板开通失败');
    expect((await call(users[1]!.id, `/v1/projects/${p.id}/provision`, 'POST')).status).toBe(403);
    expect((await call(users[2]!.id, `/v1/projects/${p.id}/provision`, 'POST')).status).toBe(403);
    expect((await call(owner.userId, `/v1/projects/${p.id}/provision`, 'POST')).status).toBe(202);
    expect((await call(admin.userId, `/v1/projects/${p.id}/provision`, 'POST')).status).toBe(202);
    expect((await call(users[2]!.id, '/v1/catalog/project-creation')).status).toBe(403);
    expect((await call(users[1]!.id, '/v1/users')).status).toBe(403);
    expect((await call(users[2]!.id, '/v1/projects')).status).toBe(403);
  });
});
