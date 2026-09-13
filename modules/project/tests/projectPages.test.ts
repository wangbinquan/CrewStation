import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Actor, ManifestKind, ProjectId } from '@crewstation/contracts';
import { IDENTITY_HEADERS, ProjectPageQuerySchema } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { createApp } from '@crewstation/http';
import { createIdentityModule, identityMigrations } from '@crewstation/module-identity';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { createProjectModule, projectMigrations } from '../wiring';
import type { ProjectModule } from '../wiring';

const available = await testDatabaseAvailable();
let db: TestDatabase, module: ProjectModule, admin: Actor, owner: Actor, member: Actor, tester: Actor, stranger: Actor;
const ids: ProjectId[] = [];
beforeAll(async () => {
  if (!available) return;
  db = await createTestDatabase([eventbusMigrations, identityMigrations, projectMigrations]);
  const identity = createIdentityModule({ db: db.db, settings: { adminEmails: [] } });
  const actors: Actor[] = [];
  for (const name of ['admin', 'owner', 'member', 'tester', 'stranger']) {
    const user = await identity.api.ensureUser({ externalId: name, name, email: `${name}@example.test` });
    actors.push({ userId: user.id, isAdmin: name === 'admin' });
  }
  [admin, owner, member, tester, stranger] = actors as [Actor, Actor, Actor, Actor, Actor];
  module = createProjectModule({ db: db.db, identity: identity.api,
    hosts: { prodHost: (s) => s, previewHost: (s) => s, serviceHost: (s) => s },
    settings: { defaultMaxConcurrentTasks: 3, defaultServicePlan: 'standard' } });
  await module.api.upsertServicePlan(admin, { name: 'standard', cpu: '1', memory: '1Gi', maxReplicas: 1, description: '' });
  for (let i = 0; i < 24; i++) {
    const kind: ManifestKind = i === 23 ? 'APIProxy' : 'DigitalWorker';
    const p = await module.api.createProject(admin, { slug: `page-${i}`, name: `项目 ${i}`, kind, ownerUserId: owner.userId, template: 'minimal-sample' }); ids.push(p.id);
    if (i < 4) await module.api.setMember(admin, p.id, { userId: member.userId, role: 'developer' });
    if (i === 0) await module.api.setMember(admin, p.id, { userId: tester.userId, role: 'tester' });
    if (i === 1) await module.api.setProjectState(p.id, 'failed', '开通失败');
  }
});
afterAll(async () => { await db?.drop(); });
const query = (value: Record<string, unknown> = {}) => ProjectPageQuerySchema.parse(value);

describe.skipIf(!available)('项目有界基础分页', () => {
  test('关联资料一次接受最多 50 个 ID，保持授权范围、去重和完整基础对象', async () => {
    expect(await module.api.readProjectBasics(stranger, ids.slice(0, 5))).toEqual([]);
    const rows = await module.api.readProjectBasics(tester, [ids[0]!, ids[1]!, ids[0]!]);
    expect(rows.map((p) => p.id)).toEqual([ids[0]!]); expect(rows[0]).toMatchObject({ name: '项目 0', kind: 'DigitalWorker' });
    expect(rows[0]?.serviceId).toBeDefined();
    expect(await module.api.readProjectBasics(admin, [])).toEqual([]);
    await expect(module.api.readProjectBasics(admin, Array.from({ length: 51 }, () => ids[0]!))).rejects.toMatchObject({ kind: 'validation' });
  });
  test('默认 20 项、按稳定 ID 翻页，角色和服务一次作用域查询，不含接入容器', async () => {
    const first = await module.api.listProjectPage(owner, query());
    expect(first.items).toHaveLength(20); expect(first.nextCursor).toBeDefined();
    expect(first.items.every((i) => i.role === 'owner' && i.ownerName === 'owner' && i.project.serviceId)).toBe(true);
    const next = await module.api.listProjectPage(owner, query({ cursor: first.nextCursor }));
    expect(next.items).toHaveLength(3); expect(next.nextCursor).toBeUndefined();
    const all = [...first.items, ...next.items].map((i) => i.project.id);
    expect(new Set(all).size).toBe(23); expect(all).toEqual([...all].sort());
    expect((await module.api.listProjectPage(admin, query({ kind: 'APIProxy,EventProducer' }))).items.map((i) => i.project.id)).toEqual([ids[23]!]);
  });
  test('范围先于分页和筛选，查名称／slug 与负责人，通配符按文字匹配', async () => {
    expect((await module.api.listProjectPage(stranger, query())).items).toEqual([]);
    expect((await module.api.listProjectPage(member, query())).items).toHaveLength(4);
    expect((await module.api.listProjectPage(member, query({ kind: 'APIProxy' }))).items).toEqual([]);
    expect((await module.api.listProjectPage(owner, query({ q: 'PAGE-1', state: 'failed', ownerUserId: owner.userId }))).items.map((i) => i.project.id)).toEqual([ids[1]!]);
    expect((await module.api.listProjectPage(owner, query({ q: '项目 1', state: 'failed' }))).items).toHaveLength(1);
    expect((await module.api.listProjectPage(owner, query({ q: '%' }))).items).toEqual([]);
    expect((await module.api.listProjectPage(owner, query({ ownerUserId: stranger.userId }))).items).toEqual([]);
    expect((await module.api.listProjectPage(tester, query())).items[0]?.role).toBe('tester');
  });
  test('游标绑定账号、管理员身份和筛选，非法范围被拒，成员变更在下一页与复核时生效', async () => {
    const page = await module.api.listProjectPage(member, query({ limit: 1 }));
    for (const actor of [owner, { ...member, isAdmin: true }]) await expect(module.api.listProjectPage(actor, query({ cursor: page.nextCursor }))).rejects.toMatchObject({ kind: 'validation' });
    for (const delta of [{ q: 'x' }, { state: 'failed' }, { ownerUserId: owner.userId }, { kind: 'APIProxy' }, { cursor: 'invalid' }]) {
      await expect(module.api.listProjectPage(member, query({ cursor: page.nextCursor, ...delta }))).rejects.toMatchObject({ kind: 'validation' });
    }
    for (const limit of [0, 51, 1.5]) expect(ProjectPageQuerySchema.safeParse({ limit }).success).toBe(false);
    const target = ids[3]!; await module.api.removeMember(admin, target, member.userId);
    expect((await module.api.readProjectPageEntries(member, [target, ids[0]!])).map((i) => i.project.id)).toEqual([ids[0]!]);
    expect((await module.api.listProjectPage(member, query({ cursor: page.nextCursor }))).items.some((i) => i.project.id === target)).toBe(false);
    await expect(module.api.getProjectPageEntry(stranger, ids[0]!)).rejects.toMatchObject({ kind: 'not_found' });
    await expect(module.api.readProjectPageEntries(admin, Array.from({ length: 51 }, () => target))).rejects.toMatchObject({ kind: 'validation' });
  });
  test('独立分页 HTTP 不被项目详情吞掉；单项目服务解析保持真实身份且不排除归档项目', async () => {
    const app = createApp({ name: 'project-pages' }); for (const route of module.http) app.route('/', route);
    const headers = { [IDENTITY_HEADERS.userId]: owner.userId };
    const page = await app.request('/v1/projects/page?limit=2', { headers });
    expect(page.status).toBe(200); expect(page.headers.get('Cache-Control')).toBe('private, no-store');
    expect((await page.json() as { items: unknown[] }).items).toHaveLength(2);
    expect((await app.request('/v1/projects/page?limit=51', { headers })).status).toBe(400);
    expect((await app.request('/v1/projects/page')).status).toBe(401);
    const id = ids[22]!, service = await module.api.resolveServiceOfProject(id);
    expect(service).toMatchObject({ projectId: id, slug: 'page-22', name: 'page-22', namespace: 'cs-page-22', kind: 'DigitalWorker', state: 'provisioning' });
    expect(service?.serviceId).toBe((await module.api.getProject(admin, id)).serviceId);
    await module.api.setProjectState(id, 'active'); await module.api.archiveProject(admin, id);
    expect(await module.api.resolveServiceOfProject(id)).toMatchObject({ projectId: id, state: 'archived' });
    expect(await module.api.resolveServiceOfProject(`prj_${'0'.repeat(32)}` as ProjectId)).toBeUndefined();
  });
  test('身份成员投影保留完整角色与范围，撤销即时移除', async () => {
    expect(await module.api.listUserMemberships(stranger.userId)).toEqual([]);
    expect(await module.api.listUserMemberships(tester.userId)).toEqual([{ projectId: ids[0]!, role: 'tester' }]);
    expect((await module.api.listUserMemberships(owner.userId))).toHaveLength(24);
    expect((await module.api.listUserMemberships(owner.userId)).every((row) => row.role === 'owner')).toBe(true);
    await module.api.setMember(admin, ids[2]!, { userId: member.userId, role: 'tester' });
    const before = await module.api.listUserMemberships(member.userId); expect(before.find((row) => row.projectId === ids[2]!)?.role).toBe('tester');
    await module.api.removeMember(admin, ids[2]!, member.userId);
    expect((await module.api.listUserMemberships(member.userId)).some((row) => row.projectId === ids[2]!)).toBe(false);
  });
});
