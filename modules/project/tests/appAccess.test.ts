import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Actor, ProjectDto, UserId } from '@crewstation/contracts';
import { IDENTITY_HEADERS } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { createApp } from '@crewstation/http';
import { createIdentityModule, identityMigrations } from '@crewstation/module-identity';
import { runMigrations } from '@crewstation/persistence';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { createProjectModule, projectMigrations } from '../wiring';
import type { ProjectModule } from '../wiring';

const available = await testDatabaseAvailable();
let tdb: TestDatabase, module: ProjectModule;
let admin: Actor, owner: Actor, dev: Actor, visitor: Actor, other: Actor;
let sequence = 0;
const hosts = { prodHost: (s: string) => `${s}.test`, previewHost: (s: string) => `preview.${s}.test`, serviceHost: (s: string) => `${s}.svc.test` };
beforeAll(async () => {
  if (!available) return;
  tdb = await createTestDatabase([eventbusMigrations, identityMigrations, projectMigrations]);
  const identity = createIdentityModule({ db: tdb.db, settings: { adminEmails: [] } });
  const actors: Actor[] = [];
  for (const name of ['admin', 'owner', 'developer', 'visitor', 'other']) {
    const user = await identity.api.ensureUser({ externalId: `access:${name}`, name, email: `${name}@example.com` });
    const want = name === 'admin' ? 'admin' : name === 'owner' || name === 'developer' ? 'developer' : 'user';
    if (user.platformRole !== want) await identity.api.setPlatformRole(user.id, { platformRole: want, expectedRole: user.platformRole });
    actors.push({ userId: user.id, isAdmin: name === 'admin' });
  }
  [admin, owner, dev, visitor, other] = actors as [Actor, Actor, Actor, Actor, Actor];
  module = createProjectModule({ db: tdb.db, identity: identity.api, hosts,
    settings: { defaultMaxConcurrentTasks: 3, defaultServicePlan: '01a0bf5d-8f4b-7fe6-8d34-68cf5c74d8ec' } });
  await module.api.createServicePlan(admin, { id: '01a0bf5d-8f4b-7fe6-8d34-68cf5c74d8ec', name: 'standard', cpu: '1', memory: '1Gi', maxReplicas: 3, description: '' });
});
afterAll(async () => { await tdb?.drop(); });
async function app(kind: ProjectDto['kind'] = 'DigitalWorker') {
  return module.api.createProject(admin, { slug: `access-${++sequence}`, name: `应用${sequence}`, kind, ownerUserId: owner.userId, template: '01a0bf5d-8f4b-7002-9560-94caf593fb19' });
}
const gate = (actor: Actor, slug: string) => module.api.appAccessBySlug({ id: actor.userId, isAdmin: actor.isAdmin }, slug);

describe.skipIf(!available)('正式地址使用权与使用申请（真实 PostgreSQL）', () => {
  test('网关判定：「项目成员」范围只放管理员、负责人与成员；拒绝时带应用名、负责人名与是否可申请；查不到项目是 unknown', async () => {
    const p = await app();
    expect(await gate(visitor, p.slug)).toEqual({ kind: 'denied', projectId: p.id, appName: p.name, ownerName: 'owner', requestable: true });
    for (const actor of [admin, owner]) expect(await gate(actor, p.slug)).toEqual({ kind: 'allowed' });
    await module.api.setMember(owner, p.id, { userId: visitor.userId, role: 'user' });
    expect(await gate(visitor, p.slug)).toEqual({ kind: 'allowed' });
    await module.api.removeMember(owner, p.id, visitor.userId);
    expect(await gate(visitor, p.slug)).toMatchObject({ kind: 'denied' });
    await module.api.setAppVisibility(owner, p.id, { mode: 'members', allowRequests: false, expectedRevision: 0 });
    expect(await gate(visitor, p.slug)).toMatchObject({ kind: 'denied', requestable: false });
    await module.api.setAppVisibility(owner, p.id, { mode: 'authenticated', allowRequests: false, expectedRevision: 1 });
    expect(await gate(visitor, p.slug)).toEqual({ kind: 'allowed' });
    expect(await gate(visitor, 'no-such-app')).toEqual({ kind: 'unknown' });
  });

  test('接入容器只给管理员与成员，拒绝时不给申请', async () => {
    const proxy = await app('APIProxy');
    expect(await gate(visitor, proxy.slug)).toMatchObject({ kind: 'denied', requestable: false });
    expect(await gate(admin, proxy.slug)).toEqual({ kind: 'allowed' });
    const status = await module.api.getAppAccessStatus(visitor, proxy.id);
    expect(status).toMatchObject({ granted: false, allowRequests: false });
    await expect(module.api.requestAppAccess(visitor, proxy.id, {})).rejects.toMatchObject({ kind: 'forbidden' });
  });

  test('申请页状态、提交、重复与已有权限；负责人读项目清单，开发者与非管理员读不到', async () => {
    const p = await app();
    expect(await module.api.getAppAccessStatus(visitor, p.id)).toEqual({ projectId: p.id, name: p.name, owner: { name: 'owner' }, granted: false, allowRequests: true, appHost: `${p.slug}.test` });
    const created = await module.api.requestAppAccess(visitor, p.id, { reason: '  要看周报  ' });
    expect(created).toMatchObject({ projectId: p.id, state: 'pending', reason: '要看周报', requestedBy: visitor.userId, requestedByName: 'visitor', requestedByEmail: 'visitor@example.com' });
    await expect(module.api.requestAppAccess(visitor, p.id, {})).rejects.toMatchObject({ kind: 'conflict', details: { code: 'already-pending' } });
    expect((await module.api.getAppAccessStatus(visitor, p.id)).latest).toMatchObject({ id: created.id, state: 'pending' });
    await expect(module.api.requestAppAccess(owner, p.id, {})).rejects.toMatchObject({ kind: 'precondition', details: { code: 'already-granted' } });
    await expect(module.api.requestAppAccess(visitor, p.id, { reason: 'x'.repeat(501) })).rejects.toMatchObject({ kind: 'validation' });
    const page = await module.api.listAppAccessRequests(owner, { projectId: p.id, state: 'pending', limit: 20 });
    expect(page.items.map((item) => item.id)).toEqual([created.id]);
    expect(page.items[0]!.project).toBeUndefined();
    await module.api.setMember(owner, p.id, { userId: dev.userId, role: 'developer' });
    await expect(module.api.listAppAccessRequests(dev, { projectId: p.id, state: 'pending', limit: 20 })).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(module.api.listAppAccessRequests(owner, { state: 'pending', limit: 20 })).rejects.toMatchObject({ kind: 'forbidden' });
    const global = await module.api.listAppAccessRequests(admin, { state: 'all', limit: 50 });
    expect(global.items.find((item) => item.id === created.id)?.project).toEqual({ id: p.id, name: p.name, slug: p.slug, kind: 'DigitalWorker' });
    await expect(module.api.decideAppAccessRequest(dev, created.id, { approve: true })).rejects.toMatchObject({ kind: 'forbidden' });
  });

  test('批准即加为「用户」、网关随即放行、只能裁决一次；拒绝带意见，被拒后可重新申请；已是成员的不降级', async () => {
    const p = await app();
    const first = await module.api.requestAppAccess(visitor, p.id, {});
    const approved = await module.api.decideAppAccessRequest(owner, first.id, { approve: true });
    expect(approved).toMatchObject({ state: 'approved', decidedBy: owner.userId, decidedByName: 'owner' });
    expect(approved.decision).toBeUndefined();
    expect(await module.api.roleOf(visitor, p.id)).toBe('user');
    expect(await gate(visitor, p.slug)).toEqual({ kind: 'allowed' });
    expect(await module.api.getAppAccessStatus(visitor, p.id)).toMatchObject({ granted: true, latest: { state: 'approved' } });
    await expect(module.api.decideAppAccessRequest(admin, first.id, { approve: false })).rejects.toMatchObject({ kind: 'precondition' });

    const rejected = await module.api.decideAppAccessRequest(admin, (await module.api.requestAppAccess(other, p.id, {})).id, { approve: false, decision: '请走部门流程' });
    expect(rejected).toMatchObject({ state: 'rejected', decision: '请走部门流程', decidedByName: 'admin' });
    expect(await module.api.getAppAccessStatus(other, p.id)).toMatchObject({ granted: false, latest: { state: 'rejected', decision: '请走部门流程' } });
    const again = await module.api.requestAppAccess(other, p.id, { reason: '部门已批' });
    expect(again).toMatchObject({ state: 'pending' });
    await module.api.setMember(owner, p.id, { userId: other.userId, role: 'tester' });
    await module.api.decideAppAccessRequest(owner, again.id, { approve: true });
    expect(await module.api.roleOf(other, p.id)).toBe('tester');
  });

  test('同一人并发提交只留下一条待处理；清单按时间倒序分页', async () => {
    const p = await app();
    const results = await Promise.allSettled([module.api.requestAppAccess(other, p.id, {}), module.api.requestAppAccess(other, p.id, {})]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toMatchObject([{ reason: { kind: 'conflict' } }]);
    await module.api.requestAppAccess(visitor, p.id, {});
    const page1 = await module.api.listAppAccessRequests(owner, { projectId: p.id, state: 'pending', limit: 1 });
    expect(page1.items[0]).toMatchObject({ requestedBy: visitor.userId }); expect(page1.nextCursor).toBeString();
    const page2 = await module.api.listAppAccessRequests(owner, { projectId: p.id, state: 'pending', limit: 1, cursor: page1.nextCursor! });
    expect(page2.items[0]).toMatchObject({ requestedBy: other.userId }); expect(page2.nextCursor).toBeUndefined();
    await expect(module.api.listAppAccessRequests(owner, { projectId: p.id, state: 'all', limit: 1, cursor: page1.nextCursor! })).rejects.toMatchObject({ kind: 'validation' });
  });

  test('HTTP：申请人一侧任何登录用户可用，审批一侧按负责人与管理员', async () => {
    const p = await app();
    const http = createApp({ name: 'app-access-test' }); for (const route of module.http) http.route('/', route);
    const call = (path: string, actor: Actor, body?: unknown) => http.request(path, { headers: { [IDENTITY_HEADERS.userId]: actor.userId, 'content-type': 'application/json' }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
    const status = await call(`/v1/apps/${p.id}/access`, visitor);
    expect(status.status).toBe(200); expect(status.headers.get('cache-control')).toBe('no-store');
    const created = await call(`/v1/apps/${p.id}/access-requests`, visitor, { reason: '试用' });
    expect(created.status).toBe(201);
    const id = (await created.json() as { id: string }).id;
    expect((await call(`/v1/apps/${p.id}/access-requests`, visitor, { reason: '试用', extra: 1 })).status).toBe(400);
    expect((await call(`/v1/app-access-requests?projectId=${p.id}`, owner)).status).toBe(200);
    expect((await call('/v1/app-access-requests', visitor)).status).toBe(403);
    expect((await call('/v1/app-access-requests/not-an-id/decision', owner, { approve: true })).status).toBe(400);
    expect((await call(`/v1/app-access-requests/${id}/decision`, visitor, { approve: true })).status).toBe(404);
    expect((await call(`/v1/app-access-requests/${id}/decision`, owner, { approve: true })).status).toBe(200);
  });
});

describe.skipIf(!available)('project/0012：取消「项目成员与指定用户」', () => {
  test('原指定用户迁成「用户」角色成员，已是成员的保留原角色；范围改回「项目成员」，默认允许申请；重跑不再变化', async () => {
    const before = { ...projectMigrations, files: projectMigrations.files.filter((file) => Number(file.name.slice(0, 4)) < 12) };
    const db = await createTestDatabase([before]);
    try {
      const project = '01a0bf5d-8f4b-7000-8000-000000000001', named = '01a0bf5d-8f4b-7000-8000-0000000000aa' as UserId, member = '01a0bf5d-8f4b-7000-8000-0000000000bb' as UserId;
      await db.db.execute(sql`INSERT INTO project.app_listings (project_id, mode, user_ids) VALUES (${project}, 'selected', ${JSON.stringify([named, member])}::jsonb)`);
      await db.db.execute(sql`INSERT INTO project.memberships (project_id, user_id, role) VALUES (${project}, ${member}, 'tester')`);
      await runMigrations(db.db, [projectMigrations]);
      const roles = await db.db.execute(sql`SELECT user_id, role FROM project.memberships WHERE project_id = ${project} ORDER BY user_id`);
      expect([...roles].map((row) => ({ ...row }))).toEqual([{ user_id: named, role: 'user' }, { user_id: member, role: 'tester' }]);
      const listing = await db.db.execute(sql`SELECT * FROM project.app_listings WHERE project_id = ${project}`);
      expect({ ...[...listing][0] }).toMatchObject({ mode: 'members', allow_requests: true });
      expect([...listing][0]).not.toHaveProperty('user_ids');
      expect(await runMigrations(db.db, [projectMigrations])).toEqual([]);
    } finally { await db.drop(); }
  });
});
