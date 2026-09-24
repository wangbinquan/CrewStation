import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Actor, ServiceId } from '@crewstation/contracts';
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
  const settings = loadPlatformSettings({ CS_DATABASE_URL: db.url, CS_SECRET_KEY: Buffer.alloc(32, 3).toString('base64'), CS_GITLAB_URL: 'http://127.0.0.1:9' });
  platform = createPlatformModule({ db: db.db, settings, k8s: createFakeK8sClient(), logger: noopLogger, instance: 'test.app-access' });
  await runMigrations(db.db, platform.api.migrations);
});
afterAll(async () => { await db?.drop(); });

describe.skipIf(!available)('应用使用权的装配（真实数据库，2026-09-24 裁定）', () => {
  test('正式版维护中只放行来验证的成员：「用户」角色和外人一样看维护页，测试者、负责人照旧进；正式地址的使用权按「用户」角色放行', async () => {
    const { identity, project, gateway } = platform.modules;
    const adminUser = await identity.api.ensureUser({ externalId: 'admin', name: 'Admin', email: 'admin@access.test' });
    const admin: Actor = { userId: adminUser.id, isAdmin: true };
    const [ownerUser, appUser, tester, outsider] = await Promise.all(['owner', 'app-user', 'tester', 'outsider'].map((name) => identity.api.ensureUser({ externalId: name, name, email: `${name}@access.test` })));
    await identity.api.setPlatformRole(ownerUser!.id, { platformRole: 'developer', expectedRole: 'user' });
    const owner: Actor = { userId: ownerUser!.id, isAdmin: false };
    await project.api.updateServicePlan(admin, '01a0bf5d-8f4b-7000-9e4b-b54e91ee9d10', { name: 'standard-small', cpu: '1', memory: '1Gi', maxReplicas: 1, description: '' });
    const p = await project.api.createProject(owner, { name: '周报助手', slug: 'app-access', kind: 'DigitalWorker', template: '01a0bf5d-8f4b-7002-9560-94caf593fb19' });
    await project.api.setMember(owner, p.id, { userId: appUser!.id, role: 'user' });
    await project.api.setMember(owner, p.id, { userId: tester!.id, role: 'tester' });

    expect(await project.api.appAccessBySlug({ id: appUser!.id, isAdmin: false }, 'app-access')).toEqual({ kind: 'allowed' });
    expect(await project.api.appAccessBySlug({ id: outsider!.id, isAdmin: false }, 'app-access')).toMatchObject({ kind: 'denied', appName: '周报助手', ownerName: 'owner', requestable: true });

    await gateway.api.setMaintenance(owner, p.serviceId as ServiceId, { switches: { users: true, services: false, events: false }, allowUserIds: [], reason: '换库', expectedRevision: 0 });
    for (const who of [appUser!, outsider!]) expect(await gateway.api.userEntry(who.id, 'app-access', 'prod')).toMatchObject({ kind: 'maintenance', reason: '换库' });
    for (const who of [tester!, ownerUser!, adminUser]) expect(await gateway.api.userEntry(who.id, 'app-access', 'prod')).toEqual({ kind: 'open' });
  });
});
