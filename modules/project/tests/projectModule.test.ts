import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Actor, ProjectId, UserId } from '@crewstation/contracts';
import { IDENTITY_HEADERS } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { createApp } from '@crewstation/http';
import { createIdentityModule, identityMigrations } from '@crewstation/module-identity';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { ProjectModule } from '../wiring';
import { createProjectModule, projectMigrations } from '../wiring';

const available = await testDatabaseAvailable();
let tdb: TestDatabase;
let project: ProjectModule;
let admin: Actor;
let owner: Actor;
let dev: Actor;
let runningTasks = 0;
const hosts = { prodHost: (s: string) => `${s}.cs.localhost`, previewHost: (s: string) => `preview.${s}.cs.localhost`, serviceHost: (s: string) => `${s}.svc.cs.internal` };

beforeAll(async () => {
  if (!available) return;
  tdb = await createTestDatabase([eventbusMigrations, identityMigrations, projectMigrations]);
  const identity = createIdentityModule({ db: tdb.db, settings: { adminEmails: [] } });
  const a = await identity.api.ensureUser({ externalId: 'demo:admin', name: 'Admin', email: 'admin@example.com' });
    if (a.platformRole === 'user') await identity.api.setPlatformRole(a.id, { platformRole: 'developer', expectedRole: 'user' });
  const o = await identity.api.ensureUser({ externalId: 'demo:owner', name: 'Owner', email: 'owner@example.com' });
    if (o.platformRole === 'user') await identity.api.setPlatformRole(o.id, { platformRole: 'developer', expectedRole: 'user' });
  const d = await identity.api.ensureUser({ externalId: 'demo:dev', name: 'Dev', email: 'dev@example.com' });
    if (d.platformRole === 'user') await identity.api.setPlatformRole(d.id, { platformRole: 'developer', expectedRole: 'user' });
  admin = { userId: a.id, isAdmin: true };
  owner = { userId: o.id, isAdmin: false };
  dev = { userId: d.id, isAdmin: false };
  project = createProjectModule({ db: tdb.db, identity: identity.api, hosts, taskUsage: { runningTasks: async () => runningTasks }, settings: { defaultMaxConcurrentTasks: 3, defaultServicePlan: '01a0bf5d-8f4b-7000-9e4b-b54e91ee9d10' } });
  await project.api.updateServicePlan(admin, '01a0bf5d-8f4b-7000-9e4b-b54e91ee9d10', { name: 'standard-small', cpu: '500m', memory: '512Mi', maxReplicas: 3, description: '' });
});
afterAll(async () => { await tdb?.drop(); });

describe.skipIf(!available)('project module', () => {
  let projectId: ProjectId;

  test('管理员代建项目：服务、负责人、配额与事件一并落库', async () => {
    const dto = await project.api.createProject(admin, { slug: 'demo', name: '演示', kind: 'DigitalWorker', ownerUserId: owner.userId, template: '01a0bf5d-8f4b-7002-9560-94caf593fb19' });
    projectId = dto.id;
    expect(dto).toMatchObject({ slug: 'demo', namespace: 'cs-demo', state: 'provisioning', ownerUserId: owner.userId });
    expect(dto.serviceId).toBeDefined();
    expect((await project.api.getQuota(owner, projectId)).maxConcurrentTasks).toBe(3);
    // 占用数来自 task-runtime 的准入计数器，不是写死的 0。
    expect((await project.api.getQuota(owner, projectId)).running).toBe(0);
    runningTasks = 2;
    expect((await project.api.getQuota(owner, projectId)).running).toBe(2);
    expect((await project.api.setQuota(admin, projectId, { maxConcurrentTasks: 5 })).running).toBe(2);
    runningTasks = 0;
    const events = (await tdb.db.execute(`SELECT topic FROM platform_infra.domain_events`)) as unknown as Array<{ topic: string }>;
    expect(events.map((e) => e.topic)).toEqual(['project.created']);
    const service = await project.api.getService(owner, dto.serviceId!);
    expect(service).toMatchObject({ identity: 'demo/demo', prodHost: 'demo.cs.localhost', previewHost: 'preview.demo.cs.localhost' });
    expect(await project.api.resolveServiceIdentity('demo/demo')).toMatchObject({ projectId, namespace: 'cs-demo' });
  });

  test('开发者不能覆盖资源；重复 slug 冲突；平台主机前缀是保留名；不存在的套餐被拒', async () => {
    const input = { slug: 'other', name: 'x', kind: 'DigitalWorker' as const, ownerUserId: owner.userId, template: '01a0bf5d-8f4b-7002-9560-94caf593fb19' };
    await expect(project.api.createProject(owner, { ...input, plan: '01a0bf5d-8f4b-7000-9e4b-b54e91ee9d10' })).rejects.toMatchObject({ kind: 'validation' });
    await expect(project.api.createProject(admin, { ...input, slug: 'demo' })).rejects.toMatchObject({ kind: 'conflict' });
    await expect(project.api.createProject(admin, { ...input, slug: 'events' })).rejects.toMatchObject({ kind: 'validation', details: { field: 'slug' } });
    await expect(project.api.createProject(admin, { ...input, plan: '01a0bf5d-8f4b-7ca3-8704-aa0b06f5954c' })).rejects.toMatchObject({ kind: 'validation' });
  });

  test('角色表：非成员 404、开发者不能切流、负责人可以、测试者只看 preview', async () => {
    await expect(project.api.getProject(dev, projectId)).rejects.toMatchObject({ kind: 'not_found' });
    await project.api.setMember(owner, projectId, { userId: dev.userId, role: 'developer' });
    expect((await project.api.listProjects(dev)).map((p) => p.slug)).toEqual(['demo']);
    await expect(project.api.authorize(dev, projectId, 'switch-traffic')).rejects.toMatchObject({ kind: 'forbidden' });
    expect(await project.api.authorize(owner, projectId, 'switch-traffic')).toBe('owner');
    await expect(project.api.setMember(dev, projectId, { userId: dev.userId, role: 'owner' })).rejects.toMatchObject({ kind: 'forbidden' });
    await project.api.setMember(owner, projectId, { userId: dev.userId, role: 'tester' });
    expect(await project.api.authorize(dev, projectId, 'view-preview')).toBe('tester');
    await expect(project.api.authorize(dev, projectId, 'develop')).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(project.api.removeMember(owner, projectId, owner.userId)).rejects.toMatchObject({ kind: 'precondition' });
  });

  test('状态机：provisioning → active → archived，非法迁移被拒', async () => {
    expect((await project.api.setProjectState(projectId, 'active')).state).toBe('active');
    await expect(project.api.setProjectState(projectId, 'provisioning')).rejects.toMatchObject({ kind: 'precondition' });
    await expect(project.api.archiveProject(owner, projectId)).rejects.toMatchObject({ kind: 'forbidden' });
    expect((await project.api.archiveProject(admin, projectId)).state).toBe('archived');
  });

  test('HTTP 路由：身份头进入、校验失败 400、非成员 404', async () => {
    const app = createApp({ name: 'test' });
    for (const router of project.http) app.route('/', router);
    const asUser = (id: UserId) => ({ [IDENTITY_HEADERS.userId]: id });
    const list = await app.request('/v1/projects', { headers: asUser(admin.userId) });
    expect((await list.json() as { items: unknown[] }).items.length).toBe(1);
    const bad = await app.request('/v1/projects', { method: 'POST', headers: { ...asUser(admin.userId), 'content-type': 'application/json' }, body: JSON.stringify({ slug: 'X' }) });
    expect(bad.status).toBe(400);
    const stranger = await app.request(`/v1/projects/${projectId}`, { headers: asUser('01a0bf5d-8f4b-7622-8c1a-d607ceefa8df' as UserId) });
    expect(stranger.status).toBe(404);
    expect((await app.request('/v1/projects')).status).toBe(401);
  });

  test('任务套餐：管理员按 UUID 更新，非管理员不能写；算力档位已移到 agent-runtime（RFC-006、ADR-0005）', async () => {
    await project.api.createTaskProfile(admin, { id: '01a0bf5d-8f4b-785b-8488-54a32a8f0e52', name: 'cli-large', cpu: '2', memory: '4Gi', storage: '2Gi', description: 'CLI' });
    await project.api.updateTaskProfile(admin, '01a0bf5d-8f4b-785b-8488-54a32a8f0e52', { name: 'cli-large', cpu: '1', memory: '4Gi', storage: '2Gi', description: 'CLI（改）' });
    expect((await project.api.listTaskProfiles()).filter((p) => p.name === 'cli-large')).toEqual([{ id: '01a0bf5d-8f4b-785b-8488-54a32a8f0e52', name: 'cli-large', cpu: '1', memory: '4Gi', storage: '2Gi', description: 'CLI（改）' }]);
    await expect(project.api.createTaskProfile(dev, { id: '01a0bf5d-8f4b-7cc9-86fe-d8b030120e59', name: 'x-y', cpu: '1', memory: '1Gi', storage: '1Gi', description: '' })).rejects.toMatchObject({ kind: 'forbidden' });
    expect(Object.keys(project.api).filter((key) => /compute/i.test(key))).toEqual([]);
  });

  test('项目列表按 kind 过滤：先作用域后过滤，成员筛不出别人的接入容器（RFC-002）', async () => {
    await project.api.createProject(admin, { slug: 'gitlab-events', name: '事件生产者', kind: 'EventProducer', ownerUserId: admin.userId, template: '01a0bf5d-8f4b-7002-9560-94caf593fb19' });
    await project.api.createProject(admin, { slug: 'ref-proxy', name: '参考代理', kind: 'APIProxy', ownerUserId: admin.userId, template: '01a0bf5d-8f4b-7002-9560-94caf593fb19' });

    const all = await project.api.listProjects(admin);
    expect(all.map((p) => p.slug).sort()).toEqual(['demo', 'gitlab-events', 'ref-proxy']);
    // 省略 kind 时行为与改动前一致。
    expect((await project.api.listProjects(admin, {})).length).toBe(all.length);

    expect((await project.api.listProjects(admin, { kind: ['DigitalWorker'] })).map((p) => p.slug)).toEqual(['demo']);
    expect((await project.api.listProjects(admin, { kind: ['APIProxy', 'EventProducer'] })).map((p) => p.slug).sort()).toEqual(['gitlab-events', 'ref-proxy']);

    // dev 是 demo 的成员、不是两个接入容器的成员：带 kind 也只在自己的作用域里筛。
    expect((await project.api.listProjects(dev, { kind: ['APIProxy', 'EventProducer'] })).map((p) => p.slug)).toEqual([]);
    expect((await project.api.listProjects(dev, { kind: ['DigitalWorker'] })).map((p) => p.slug)).toEqual([]);
  });

  test('HTTP 的 kind 是逗号分隔串，非法值 400（RFC-002）', async () => {
    const app = createApp({ name: 'test' });
    for (const router of project.http) app.route('/', router);
    const headers = { [IDENTITY_HEADERS.userId]: admin.userId };
    const filtered = await app.request('/v1/projects?kind=APIProxy,EventProducer', { headers });
    expect((await filtered.json() as { items: { slug: string }[] }).items.map((i) => i.slug).sort()).toEqual(['gitlab-events', 'ref-proxy']);
    expect((await app.request('/v1/projects?kind=Nope', { headers })).status).toBe(400);
  });

  test('开通读取创建时的模板、套餐和名称；默认套餐也落库，重试不会丢失', async () => {
    await project.api.createServicePlan(admin, { id: '01a0bf5d-8f4b-76b5-8a28-f084e91fddf4', name: 'standard-large', cpu: '2', memory: '4Gi', maxReplicas: 4, description: '大套餐' });
    const dto = await project.api.createProject(admin, { slug: 'custom-init', name: '自定义开通', kind: 'DigitalWorker', ownerUserId: owner.userId,
      template: '01a0bf5d-8f4b-7927-8ad2-7c3ceb4bcd10', plan: '01a0bf5d-8f4b-76b5-8a28-f084e91fddf4', maxConcurrentTasks: 7 });
    // 原实现只校验 plan 后丢弃；异步开通拿不到用户确认过的初始套餐。
    const rows = await tdb.db.execute("SELECT to_jsonb(p) AS row FROM project.projects p WHERE slug = 'custom-init'") as unknown as Array<{ row: { initial_plan?: string } }>;
    expect(rows[0]?.row.initial_plan).toBe('01a0bf5d-8f4b-76b5-8a28-f084e91fddf4');
    expect(await project.api.getProvisioningProject(dto.id)).toMatchObject({ projectId: dto.id, serviceId: dto.serviceId, state: 'provisioning',
      name: '自定义开通', template: '01a0bf5d-8f4b-7927-8ad2-7c3ceb4bcd10', initialPlan: '01a0bf5d-8f4b-76b5-8a28-f084e91fddf4' });
    expect((await project.api.getQuota(admin, dto.id)).maxConcurrentTasks).toBe(7);
    await project.api.setProjectState(dto.id, 'failed', 'first attempt failed');
    await project.api.setProjectState(dto.id, 'provisioning');
    expect(await project.api.getProvisioningProject(dto.id)).toMatchObject({ initialPlan: '01a0bf5d-8f4b-76b5-8a28-f084e91fddf4', template: '01a0bf5d-8f4b-7927-8ad2-7c3ceb4bcd10' });
    const defaults = await project.api.createProject(admin, { slug: 'default-init', name: '默认', kind: 'DigitalWorker', ownerUserId: owner.userId, template: '01a0bf5d-8f4b-7002-9560-94caf593fb19' });
    expect(await project.api.getProvisioningProject(defaults.id)).toMatchObject({ initialPlan: '01a0bf5d-8f4b-7000-9e4b-b54e91ee9d10' });
    await tdb.db.execute("UPDATE project.projects SET initial_plan = NULL WHERE slug = 'default-init'");
    await project.api.setProjectState(defaults.id, 'failed', 'legacy retry');
    expect(await project.api.getProvisioningProject(defaults.id)).not.toHaveProperty('initialPlan');
    expect(await project.api.getProvisioningProject('01a0bf5d-8f4b-7206-87a4-93e975cdc6ee' as ProjectId)).toBeUndefined();
    expect(await project.api.getProvisioningProject(projectId)).toBeUndefined();
  });
});
