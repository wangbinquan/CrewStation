import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Actor, ProjectDto, ProjectId } from '@crewstation/contracts';
import { IDENTITY_HEADERS } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { createApp } from '@crewstation/http';
import { createIdentityModule, identityMigrations } from '@crewstation/module-identity';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { createProjectModule, projectMigrations } from '../wiring';
import type { ProjectModule } from '../wiring';

const available = await testDatabaseAvailable();
let tdb: TestDatabase, module: ProjectModule, secondModule: ProjectModule;
let admin: Actor, owner: Actor, dev: Actor, tester: Actor, visitor: Actor, other: Actor, plain: Actor;
let sequence = 0;
beforeAll(async () => {
  if (!available) return;
  tdb = await createTestDatabase([eventbusMigrations, identityMigrations, projectMigrations]);
  const identity = createIdentityModule({ db: tdb.db, settings: { adminEmails: [] } });
  const actors: Actor[] = [];
  for (const name of ['admin', 'owner', 'developer', 'tester', 'visitor', 'other']) {
    const user = await identity.api.ensureUser({ externalId: `demo:${name}`, name, email: `${name}@example.com` });
    if (user.platformRole === 'user') await identity.api.setPlatformRole(user.id, { platformRole: 'developer', expectedRole: 'user' });
    actors.push({ userId: user.id, isAdmin: name === 'admin' });
  }
  [admin, owner, dev, tester, visitor, other] = actors as [Actor, Actor, Actor, Actor, Actor, Actor];
  // 平台普通用户：只能被设成测试者或「用户」。
  plain = { userId: (await identity.api.ensureUser({ externalId: 'demo:plain', name: 'plain', email: 'plain@example.com' })).id, isAdmin: false };
  module = createProjectModule({ db: tdb.db, identity: identity.api,
    hosts: { prodHost: (s) => `${s}.test`, previewHost: (s) => `preview.${s}.test`, serviceHost: (s) => `${s}.svc.test` },
    settings: { defaultMaxConcurrentTasks: 3, defaultServicePlan: '01a0bf5d-8f4b-7fe6-8d34-68cf5c74d8ec' },
  });
  secondModule = createProjectModule({ db: tdb.db, identity: identity.api,
    hosts: { prodHost: (s) => `${s}.test`, previewHost: (s) => `preview.${s}.test`, serviceHost: (s) => `${s}.svc.test` },
    settings: { defaultMaxConcurrentTasks: 3, defaultServicePlan: '01a0bf5d-8f4b-7fe6-8d34-68cf5c74d8ec' },
  });
  await module.api.createServicePlan(admin, { id: '01a0bf5d-8f4b-7fe6-8d34-68cf5c74d8ec', name: 'standard', cpu: '1', memory: '1Gi', maxReplicas: 3, description: '' });
});
afterAll(async () => { await tdb?.drop(); });
async function app(name = '协同应用', kind: ProjectDto['kind'] = 'DigitalWorker') {
  return module.api.createProject(admin, { slug: `market-${++sequence}`, name, kind, ownerUserId: owner.userId, template: '01a0bf5d-8f4b-7002-9560-94caf593fb19' });
}
const query = (q = '') => ({ limit: 50, q });

describe.skipIf(!available)('市场范围与展示资料（真实 PostgreSQL）', () => {
  test('默认仅成员；测试者可看市场及范围但仍不能开发；非成员没有内部项目投影', async () => {
    const p = await app();
    await module.api.setMember(owner, p.id, { userId: dev.userId, role: 'developer' });
    await module.api.setMember(owner, p.id, { userId: tester.userId, role: 'tester' });
    expect(await module.api.getAppVisibility(owner, p.id)).toMatchObject({ mode: 'members', allowRequests: true, revision: 0, canConfigure: true });
    expect(await module.api.getAppVisibility(tester, p.id)).toMatchObject({ mode: 'members', canConfigure: false });
    expect(await module.api.getMarketListing(tester, p.id)).toMatchObject({ canDevelop: false, canConfigure: false });
    expect(await module.api.getMarketListing(dev, p.id)).toMatchObject({ canDevelop: true, canConfigure: false });
    await expect(module.api.getMarketListing(visitor, p.id)).rejects.toMatchObject({ kind: 'not_found' });
    await expect(module.api.authorize(tester, p.id, 'develop')).rejects.toMatchObject({ kind: 'forbidden' });
    const publicSetting = { mode: 'authenticated' as const, allowRequests: true, expectedRevision: 0 };
    for (const actor of [dev, tester]) await expect(module.api.setAppVisibility(actor, p.id, publicSetting)).rejects.toMatchObject({ kind: 'forbidden' });
    await module.api.setAppVisibility(owner, p.id, publicSetting);
    expect((await module.api.listMarketListings(visitor, query())).items.map((x) => x.projectId)).toContain(p.id);
    await expect(module.api.getProject(visitor, p.id)).rejects.toMatchObject({ kind: 'not_found' });
    await expect(module.api.getAppVisibility(visitor, p.id)).rejects.toMatchObject({ kind: 'not_found' });
  });
  test('「用户」角色：平台普通用户也能加；市场里看得到，不试用待命版、不进项目、不读可见范围（2026-09-24 裁定）', async () => {
    const p = await app();
    expect(await module.api.memberCandidates(owner, p.id, 'VISITOR@example.com')).toEqual([{ userId: visitor.userId, name: 'visitor', email: 'visitor@example.com', platformRole: 'developer' }]);
    expect(await module.api.memberCandidates(owner, p.id, visitor.userId)).toHaveLength(1);
    expect(await module.api.memberCandidates(owner, p.id, 'vis')).toEqual([]);
    await expect(module.api.setMember(owner, p.id, { userId: plain.userId, role: 'developer' })).rejects.toMatchObject({ kind: 'validation' });
    expect(await module.api.setMember(owner, p.id, { userId: plain.userId, role: 'user' })).toMatchObject({ role: 'user' });
    await expect(module.api.setMember(dev, p.id, { userId: visitor.userId, role: 'user' })).rejects.toMatchObject({ kind: 'not_found' });
    expect(await module.api.roleOf(plain, p.id)).toBe('user');
    expect(await module.api.getMarketListing(plain, p.id)).toMatchObject({ projectId: p.id, canPreview: false, canDevelop: false, canConfigure: false });
    await expect(module.api.authorize(plain, p.id, 'view-preview')).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(module.api.getProject(plain, p.id)).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(module.api.getAppVisibility(plain, p.id)).rejects.toMatchObject({ kind: 'forbidden' });
    // 平台开发者被设成「用户」时同样不进项目列表。
    await module.api.setMember(owner, p.id, { userId: visitor.userId, role: 'user' });
    expect((await module.api.listProjects(visitor)).map((x) => x.id)).not.toContain(p.id);
    expect(await module.api.listUserMemberships(visitor.userId)).toContainEqual({ projectId: p.id, role: 'user' });
  });
  test('两个实例同 revision 并发只有一次保存；展示资料与范围共用修订且不丢其他字段', async () => {
    const p = await app();
    const results = await Promise.allSettled([
      module.api.setAppVisibility(owner, p.id, { mode: 'authenticated', allowRequests: false, expectedRevision: 0 }),
      secondModule.api.setAppPresentation(owner, p.id, { description: '整理团队知识', icon: 'book', expectedRevision: 0 }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toMatchObject([{ reason: { kind: 'conflict' } }]);
    const before = await module.api.getAppVisibility(owner, p.id);
    await module.api.setAppPresentation(owner, p.id, { description: '整理团队知识', icon: 'book', expectedRevision: before.revision });
    expect(await module.api.getAppVisibility(owner, p.id)).toMatchObject({ mode: before.mode, allowRequests: before.allowRequests, revision: 2 });
    expect(await module.api.getMarketListing(owner, p.id)).toMatchObject({ description: '整理团队知识', icon: 'book', visibilityRevision: 2 });
  });
  test('先授权后搜索分页，隐藏匹配不泄漏；接入容器对管理员也不混入市场', async () => {
    const prefix = '分页专用';
    const hidden = await app(`${prefix}隐藏`), first = await app(`${prefix}一`), second = await app(`${prefix}二`);
    await app(`${prefix}接入`, 'APIProxy');
    for (const p of [first, second]) await module.api.setAppVisibility(owner, p.id, { mode: 'authenticated', allowRequests: true, expectedRevision: 0 });
    const page1 = await module.api.listMarketListings(visitor, { q: prefix, limit: 1 });
    expect(page1.items.map((x) => x.projectId)).toEqual([first.id]); expect(page1.nextCursor).toBeString();
    const page2 = await module.api.listMarketListings(visitor, { q: prefix, limit: 1, cursor: page1.nextCursor! });
    expect(page2.items.map((x) => x.projectId)).toEqual([second.id]); expect(page2.nextCursor).toBeUndefined();
    expect((await module.api.listMarketListings(visitor, query(`${prefix}隐藏`))).items).toEqual([]);
    expect((await module.api.listMarketListings(admin, query(prefix))).items).toHaveLength(3);
    await expect(module.api.listMarketListings(other, { q: prefix, limit: 1, cursor: page1.nextCursor! })).rejects.toMatchObject({ kind: 'validation' });
    await expect(module.api.getMarketListing(visitor, hidden.id)).rejects.toMatchObject({ kind: 'not_found' });
    await module.api.setAppVisibility(owner, first.id, { mode: 'members', allowRequests: true, expectedRevision: 1 });
    expect((await module.api.listMarketListings(visitor, query(prefix))).items.map((x) => x.projectId)).toEqual([second.id]);
    await expect(module.api.getMarketListing(visitor, first.id)).rejects.toMatchObject({ kind: 'not_found' });
  });
  test('成员移除即时影响市场；HTTP 校验、冲突和普通用户的范围查询边界', async () => {
    const p = await app(); await module.api.setMember(owner, p.id, { userId: other.userId, role: 'tester' });
    expect(await module.api.getMarketListing(other, p.id)).toMatchObject({ projectId: p.id });
    await module.api.removeMember(owner, p.id, other.userId);
    await expect(module.api.getMarketListing(other, p.id)).rejects.toMatchObject({ kind: 'not_found' });
    const http = createApp({ name: 'market-test' }); for (const route of module.http) http.route('/', route);
    const request = (path: string, actor = owner, body?: unknown) => http.request(`/v1/projects/${p.id}/${path}`, { headers: { [IDENTITY_HEADERS.userId]: actor.userId, 'content-type': 'application/json' }, ...(body ? { method: 'PUT', body: JSON.stringify(body) } : {}) });
    // 「项目成员与指定用户」一档与名单字段都已取消（2026-09-24）：旧形状的请求一律 400。
    expect((await request('app-visibility', owner, { mode: 'selected', allowRequests: true, expectedRevision: 0 })).status).toBe(400);
    expect((await request('app-visibility', owner, { mode: 'members', allowRequests: true, userIds: [], expectedRevision: 0 })).status).toBe(400);
    expect((await request('app-visibility', owner, { mode: 'members', expectedRevision: 0 })).status).toBe(400);
    expect((await request('app-visibility', owner, { mode: 'members', allowRequests: true, expectedRevision: 1 })).status).toBe(409);
    // 「检查保存后的效果」连同检查接口已删除（2026-09-23 作者裁定）：负责人与管理员请求也是 404，不再按已保存范围代查某人。
    for (const actor of [owner, admin]) expect((await request(`app-visibility/check?userId=${visitor.userId}`, actor)).status).toBe(404);
    expect('checkAppVisibility' in module.api).toBe(false);
    expect((await request('member-candidates?identity=visitor%40example.com', visitor)).status).toBe(404);
    expect((await request('app-visibility', admin)).status).toBe(200);
    expect((await request('app-visibility', owner, { mode: 'authenticated', allowRequests: false, expectedRevision: 0 })).status).toBe(200);
    await expect(module.api.getAppVisibility(visitor, '01a0bf5d-8f4b-7206-87a4-93e975cdc6ee' as ProjectId)).rejects.toMatchObject({ kind: 'not_found' });
  });
});
