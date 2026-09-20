import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Actor, UserDto } from '@crewstation/contracts';
import { IDENTITY_HEADERS, ProjectPageQuerySchema } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { createApp } from '@crewstation/http';
import { connectDatabase } from '@crewstation/persistence';
import { createIdentityModule, identityMigrations } from '@crewstation/module-identity';
import type { IdentityModule } from '@crewstation/module-identity';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { createProjectModule, projectMigrations } from '../wiring';
import type { ProjectModule } from '../wiring';

const available = await testDatabaseAvailable();
let db: TestDatabase, identity: IdentityModule, project: ProjectModule;
let admin: Actor, developer: Actor, member: Actor;
const asActor = (user: UserDto): Actor => ({ userId: user.id, isAdmin: user.isAdmin });
const input = (slug: string) => ({ name: '应用', slug, kind: 'DigitalWorker' as const, template: '01a0bf5d-8f4b-7002-9560-94caf593fb19' });
beforeAll(async () => {
  if (!available) return;
  db = await createTestDatabase([eventbusMigrations, identityMigrations, projectMigrations]);
  identity = createIdentityModule({ db: db.db, settings: { adminEmails: [] }, membershipLookup: { membershipsOf: (id) => project.api.listUserMemberships(id) } });
  admin = asActor(await identity.api.ensureUser({ externalId: 'admin', name: 'Admin', email: 'admin@test.invalid' }));
  const user = await identity.api.ensureUser({ externalId: 'dev', name: 'Developer', email: 'dev@test.invalid' });
  developer = asActor(await identity.api.setPlatformRole(user.id, { platformRole: 'developer', expectedRole: 'user' }));
  member = asActor(await identity.api.ensureUser({ externalId: 'user', name: 'User', email: 'user@test.invalid' }));
  project = createProjectModule({ db: db.db, identity: identity.api, hosts: { prodHost: (s) => s, previewHost: (s) => `preview.${s}`, serviceHost: (s) => s },
    creationTemplates: { list: async () => [{ id: '01a0bf5d-8f4b-7002-9560-94caf593fb19', name: 'minimal-sample', kind: 'DigitalWorker', requiredConfig: [], servicePlan: '01a0bf5d-8f4b-7fe6-8d34-68cf5c74d8ec' }] },
    settings: { defaultMaxConcurrentTasks: 3, defaultServicePlan: '01a0bf5d-8f4b-7fe6-8d34-68cf5c74d8ec' } });
  await project.api.createServicePlan(admin, { id: '01a0bf5d-8f4b-7fe6-8d34-68cf5c74d8ec', name: 'standard', cpu: '1', memory: '1Gi', maxReplicas: 2, description: '' });
});
afterAll(async () => { await db?.drop(); });

describe.skipIf(!available)('平台开发资格、自建与成员资格', () => {
  test('开发者无项目也可自建，本人 owner、默认资源、服务与事件原子落库', async () => {
    expect(await project.api.listProjects(developer)).toEqual([]);
    expect(await project.api.creationCatalog(developer)).toMatchObject({ defaultServicePlan: '01a0bf5d-8f4b-7fe6-8d34-68cf5c74d8ec', maxConcurrentTasks: 3 });
    const p = await project.api.createProject(developer, input('self-built'));
    expect(p).toMatchObject({ ownerUserId: developer.userId, state: 'provisioning', kind: 'DigitalWorker' });
    expect(await project.api.listMembers(developer, p.id)).toEqual([expect.objectContaining({ userId: developer.userId, role: 'owner' })]);
    expect(await project.api.getQuota(developer, p.id)).toMatchObject({ maxConcurrentTasks: 3 });
    expect(await project.api.authorize(developer, p.id, 'switch-traffic')).toBe('owner');
    expect(await project.api.getProvisioningProject(p.id)).toMatchObject({ initialPlan: '01a0bf5d-8f4b-7fe6-8d34-68cf5c74d8ec', template: '01a0bf5d-8f4b-7002-9560-94caf593fb19' });
    const events = await db.db.execute<{ topic: string }>('select topic from platform_infra.domain_events');
    expect(events.map((e) => e.topic)).toEqual(['project.created']);
    await expect(identity.api.setPlatformRole(developer.userId, { expectedRole: 'developer', platformRole: 'user' })).rejects.toMatchObject({ kind: 'precondition' });
  });

  test('伪造负责人、接入类型、资源、模板、未知字段与普通用户创建拒绝且无写入', async () => {
    const http = createApp({ name: 'self-create' }); for (const route of project.http) http.route('/', route);
    for (const [actor, patch, status] of [[member, {}, 403], [developer, { ownerUserId: admin.userId }, 400], [developer, { kind: 'APIProxy' }, 400],
      [developer, { plan: '01a0bf5d-8f4b-7fe6-8d34-68cf5c74d8ec' }, 400], [developer, { maxConcurrentTasks: 9 }, 400], [developer, { template: '01a0bf5d-8f4b-7f50-87a5-088d932fb0b0' }, 400], [developer, { arbitrary: true }, 400]] as const) {
      const response = await http.request('/v1/projects', { method: 'POST', headers: { [IDENTITY_HEADERS.userId]: actor.userId, 'content-type': 'application/json' }, body: JSON.stringify({ ...input('denied'), ...patch }) });
      expect(response.status).toBe(status);
    }
    expect(await project.api.listProjects(admin)).toHaveLength(1);
    expect((await db.db.execute('select * from platform_infra.domain_events')).length).toBe(1);
    expect((await http.request('/v1/catalog/project-creation', { headers: { [IDENTITY_HEADERS.userId]: member.userId } })).status).toBe(403);
  });

  test('平台 user 的成员仅供试用；开发者 tester-only 不进入开发列表；管理员保留接入项目', async () => {
    const p = await project.api.createProject(admin, input('admin-owned'));
    await project.api.setMember(admin, p.id, { userId: member.userId, role: 'tester' });
    await project.api.setMember(admin, p.id, { userId: developer.userId, role: 'tester' });
    expect(await project.api.authorize(member, p.id, 'view-preview')).toBe('tester');
    await expect(project.api.getProject(member, p.id)).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(project.api.listProjects(member)).rejects.toMatchObject({ kind: 'forbidden' });
    expect((await project.api.getMarketListing(member, p.id)).canPreview).toBe(true);
    for (const role of ['owner', 'developer'] as const) await expect(project.api.setMember(admin, p.id, { userId: member.userId, role })).rejects.toMatchObject({ kind: 'validation' });
    const integration = await project.api.createProject(admin, { ...input('integration'), kind: 'APIProxy' });
    await project.api.setMember(admin, integration.id, { userId: developer.userId, role: 'developer' });
    expect((await project.api.listProjectPage(developer, ProjectPageQuerySchema.parse({}))).items.map((i) => i.project.slug)).toEqual(['self-built']);
    await expect(project.api.getProject(developer, integration.id)).rejects.toMatchObject({ kind: 'forbidden' });
  });

  test('转交负责人后可降级，存量 developer 关系不再授权，恢复角色后重新有效', async () => {
    const p = (await project.api.listProjects(developer))[0]!;
    await project.api.setMember(admin, p.id, { userId: admin.userId, role: 'owner' });
    await identity.api.setPlatformRole(developer.userId, { expectedRole: 'developer', platformRole: 'user' });
    await expect(project.api.authorize({ ...developer, isAdmin: true }, p.id, 'develop')).rejects.toMatchObject({ kind: 'forbidden' });
    expect(await project.api.authorize(developer, p.id, 'view-preview')).toBe('tester');
    await identity.api.setPlatformRole(developer.userId, { expectedRole: 'user', platformRole: 'developer' });
    expect(await project.api.authorize(developer, p.id, 'develop')).toBe('developer');
    await expect(project.api.getProject(member, p.id)).rejects.toMatchObject({ kind: 'not_found' });
  });

  test('自建与管理员降级并发时不能留下平台 user 负责人', async () => {
    const user = await identity.api.ensureUser({ externalId: 'race', name: 'Race', email: 'race@test.invalid' });
    const dev = asActor(await identity.api.setPlatformRole(user.id, { platformRole: 'developer', expectedRole: 'user' }));
    const results = await Promise.allSettled([
      project.api.createProject(dev, input('racing-create')),
      identity.api.setPlatformRole(user.id, { platformRole: 'user', expectedRole: 'developer' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const owns = (await project.api.listUserMemberships(user.id)).some((m) => m.role === 'owner');
    expect((await identity.api.getUser(user.id))?.platformRole).toBe(owns ? 'developer' : 'user');
  });

  test('不同创建者并发自建时，权限协调不会占满业务事务所需的连接池', async () => {
    const actors: Actor[] = [];
    for (let i = 0; i < 4; i += 1) {
      const user = await identity.api.ensureUser({ externalId: `pool-${i}`, name: `Pool ${i}`, email: `pool-${i}@test.invalid` });
      actors.push(asActor(await identity.api.setPlatformRole(user.id, { platformRole: 'developer', expectedRole: 'user' })));
    }
    const url = new URL(db.url); url.searchParams.set('options', '-c idle_in_transaction_session_timeout=500');
    const limited = connectDatabase(url.toString(), { max: 2 });
    const concurrent = createProjectModule({ db: limited.db, identity: identity.api,
      hosts: { prodHost: (s) => s, previewHost: (s) => `preview.${s}`, serviceHost: (s) => s },
      // 模拟慢模板目录：两个独立协调事务若同时持有全部连接，后续项目事务便无法开始。
      creationTemplates: { list: async () => { await Bun.sleep(50); return [{ id: '01a0bf5d-8f4b-7002-9560-94caf593fb19', name: 'minimal-sample', kind: 'DigitalWorker', requiredConfig: [], servicePlan: '01a0bf5d-8f4b-7fe6-8d34-68cf5c74d8ec' }]; } },
      settings: { defaultMaxConcurrentTasks: 3, defaultServicePlan: '01a0bf5d-8f4b-7fe6-8d34-68cf5c74d8ec' } });
    try {
      const results = await Promise.allSettled(actors.map((actor, i) => concurrent.api.createProject(actor, input(`pool-create-${i}`))));
      expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled', 'fulfilled']);
      expect((await project.api.listProjects(admin)).filter((item) => item.slug.startsWith('pool-create-'))).toHaveLength(4);
    } finally { await limited.close(); }
  });
});
