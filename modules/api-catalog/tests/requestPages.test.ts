import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Actor, ProjectDto } from '@crewstation/contracts';
import { IDENTITY_HEADERS } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { createApp } from '@crewstation/http';
import { newId } from '@crewstation/kernel';
import { createIdentityModule, identityMigrations } from '@crewstation/module-identity';
import { createProjectModule, projectMigrations } from '@crewstation/module-project';
import type { ProjectModule } from '@crewstation/module-project';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { drizzleRequestRepository } from '../adapters/persistence/drizzleGrantRepositories';
import { apiCatalogMigrations, createApiCatalogModule } from '../wiring';
import type { ApiCatalogModule } from '../wiring';

const available = await testDatabaseAvailable();
let db: TestDatabase, projects: ProjectModule, catalog: ApiCatalogModule, admin: Actor, member: Actor;
let alpha: ProjectDto, beta: ProjectDto;
const hosts = { prodHost: (s: string) => `${s}.test.invalid`, previewHost: (s: string) => `preview.${s}.test.invalid`, serviceHost: (s: string) => `${s}.internal`, platformApiHost: () => 'api.test.internal' };
const services = { resolveService: async () => undefined, resolveServiceIdentity: async () => undefined };
beforeAll(async () => {
  if (!available) return;
  db = await createTestDatabase([eventbusMigrations, identityMigrations, projectMigrations, apiCatalogMigrations]);
  const identity = createIdentityModule({ db: db.db, settings: { adminEmails: ['admin@test.invalid'] } });
  admin = { userId: (await identity.api.ensureUser({ externalId: 'admin', name: 'Admin', email: 'admin@test.invalid' })).id, isAdmin: true };
  member = { userId: (await identity.api.ensureUser({ externalId: 'member', name: 'Member', email: 'member@test.invalid' })).id, isAdmin: false };
  projects = createProjectModule({ db: db.db, identity: identity.api, hosts, settings: { defaultMaxConcurrentTasks: 3, defaultServicePlan: 'small' } });
  await projects.api.upsertServicePlan(admin, { name: 'small', cpu: '1', memory: '1Gi', maxReplicas: 1, description: '' });
  alpha = await projects.api.createProject(admin, { name: 'Alpha', slug: 'alpha', kind: 'DigitalWorker', ownerUserId: member.userId, template: 'sample' });
  beta = await projects.api.createProject(admin, { name: 'Beta', slug: 'beta', kind: 'APIProxy', ownerUserId: admin.userId, template: 'sample' });
  catalog = createApiCatalogModule({ db: db.db, projects: projects.api, services, hosts });
  const repo = drizzleRequestRepository(db.db);
  for (let i = 0; i < 72; i++) {
    const p = i < 52 ? alpha : beta;
    await repo.insert({ id: newId('req'), projectId: p.id, serviceId: p.serviceId!, operationKey: `sample:GET:/${i}`, state: i % 2 === 0 ? 'pending' : 'rejected', requestedBy: admin.userId,
      createdAt: new Date(Date.UTC(2026, 8, 1, 0, 0, Math.floor(i / 3))) });
  }
});
afterAll(async () => { await db?.drop(); });

describe.skipIf(!available)('API 申请有界分页', () => {
  test('项目与状态先于分页，默认 20；时间相同用 ID 稳定排序，关联当前页真实项目', async () => {
    const first = await catalog.api.listRequestPage(admin, { state: 'pending', limit: 20 });
    expect(first.items).toHaveLength(20); expect(first.nextCursor).toBeDefined();
    expect(first.items.every((r) => r.state === 'pending' && r.project?.id === r.projectId)).toBe(true);
    const second = await catalog.api.listRequestPage(admin, { state: 'pending', limit: 20, cursor: first.nextCursor });
    expect(second.items).toHaveLength(16); expect(second.nextCursor).toBeUndefined();
    const expected = (await drizzleRequestRepository(db.db).list()).filter((r) => r.state === 'pending').sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
    expect([...first.items, ...second.items].map((r) => r.id)).toEqual(expected.map((r) => r.id));
    const scoped = await catalog.api.listRequestPage(member, { projectId: alpha.id, state: 'all', limit: 50 });
    expect(scoped.items).toHaveLength(50); expect(scoped.items.every((r) => r.projectId === alpha.id && r.project?.name === 'Alpha')).toBe(true);
  });

  test('每页沿用现有项目查看边界，游标不能跨账号、项目或筛选', async () => {
    await expect(catalog.api.listRequestPage(member, { state: 'all', limit: 20 })).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(catalog.api.listRequestPage(member, { projectId: beta.id, state: 'all', limit: 20 })).rejects.toMatchObject({ kind: 'not_found' });
    const first = await catalog.api.listRequestPage(admin, { projectId: alpha.id, state: 'pending', limit: 5 });
    for (const query of [{ projectId: beta.id, state: 'pending' as const }, { projectId: alpha.id, state: 'all' as const }]) {
      await expect(catalog.api.listRequestPage(admin, { ...query, limit: 5, cursor: first.nextCursor })).rejects.toMatchObject({ kind: 'validation' });
    }
    await expect(catalog.api.listRequestPage(member, { projectId: alpha.id, state: 'pending', limit: 5, cursor: first.nextCursor })).rejects.toMatchObject({ kind: 'validation' });
    await projects.api.setMember(admin, beta.id, { userId: member.userId, role: 'tester' });
    await expect(catalog.api.listRequestPage(member, { projectId: beta.id, state: 'all', limit: 5 })).rejects.toMatchObject({ kind: 'forbidden' });
    await projects.api.setMember(admin, beta.id, { userId: member.userId, role: 'developer' });
    const memberPage = await catalog.api.listRequestPage(member, { projectId: beta.id, state: 'all', limit: 5 });
    await projects.api.removeMember(admin, beta.id, member.userId);
    await expect(catalog.api.listRequestPage(member, { projectId: beta.id, state: 'all', limit: 5, cursor: memberPage.nextCursor })).rejects.toMatchObject({ kind: 'not_found' });
  });

  test('锚点裁定后仍可续页，新申请在重新读取第一页时出现；项目名称失败保留申请', async () => {
    const first = await catalog.api.listRequestPage(admin, { state: 'pending', limit: 5 }), anchor = first.items.at(-1)!;
    await catalog.api.decideRequest(admin, anchor.id, { approve: false, decision: '已处理' });
    const second = await catalog.api.listRequestPage(admin, { state: 'pending', limit: 5, cursor: first.nextCursor });
    expect(second.items).toHaveLength(5); expect(second.items.some((r) => first.items.some((before) => before.id === r.id))).toBe(false);
    const id = newId('req');
    await drizzleRequestRepository(db.db).insert({ id, projectId: alpha.id, serviceId: alpha.serviceId!, operationKey: 'new:GET:/new', state: 'pending', requestedBy: admin.userId, createdAt: new Date('2026-09-02T00:00:00Z') });
    expect((await catalog.api.listRequestPage(admin, { state: 'pending', limit: 5 })).items[0]?.id).toBe(id);
    const failedNames = createApiCatalogModule({ db: db.db, projects: { ...projects.api, readProjectBasics: async () => { throw new Error('names unavailable'); } }, services, hosts });
    const page = await failedNames.api.listRequestPage(admin, { state: 'pending', limit: 5 });
    expect(page.items).toHaveLength(5); expect(page.items[0]).toMatchObject({ id, projectId: alpha.id }); expect(page.items[0]?.project).toBeUndefined();
  });

  test('HTTP 默认页、上限、非法游标、当前身份与 no-store', async () => {
    const app = createApp({ name: 'request-pages' }); for (const r of catalog.http) app.route('/', r);
    const headers = { [IDENTITY_HEADERS.userId]: admin.userId }, path = '/v1/api-requests/page';
    const response = await app.request(path, { headers }); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await response.json() as { items: unknown[] }).items).toHaveLength(20);
    for (const query of ['limit=51', 'limit=0', 'state=done', 'projectId=bad', 'cursor=invalid']) expect((await app.request(`${path}?${query}`, { headers })).status).toBe(400);
    expect((await app.request(path)).status).toBe(401); expect((await app.request(path, { headers: { [IDENTITY_HEADERS.userId]: member.userId } })).status).toBe(403);
  });
});
