import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Actor, ProjectId, UserId } from '@crewstation/contracts';
import { IDENTITY_HEADERS } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { createApp } from '@crewstation/http';
import { createIdentityModule, identityMigrations } from '@crewstation/module-identity';
import { createProjectModule, projectMigrations } from '@crewstation/module-project';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { EgressModule } from '../wiring';
import { createEgressModule, egressMigrations } from '../wiring';

const available = await testDatabaseAvailable();
let tdb: TestDatabase;
let egress: EgressModule;
let admin: Actor;
let owner: Actor;
let dev: Actor;
let projectId: ProjectId;
let otherProjectId: ProjectId;
const stranger: Actor = { userId: 'usr_00000000000000000000000000000000' as UserId, isAdmin: false };
const hosts = { prodHost: (s: string) => `${s}.cs.localhost`, previewHost: (s: string) => `preview.${s}.cs.localhost`, serviceHost: (s: string) => `${s}.svc.cs.internal` };

beforeAll(async () => {
  if (!available) return;
  tdb = await createTestDatabase([eventbusMigrations, identityMigrations, projectMigrations, egressMigrations]);
  const identity = createIdentityModule({ db: tdb.db, settings: { adminEmails: [] } });
  const a = await identity.api.ensureUser({ externalId: 'demo:admin', name: 'Admin', email: 'admin@example.com' });
  const o = await identity.api.ensureUser({ externalId: 'demo:owner', name: 'Owner', email: 'owner@example.com' });
  const d = await identity.api.ensureUser({ externalId: 'demo:dev', name: 'Dev', email: 'dev@example.com' });
  admin = { userId: a.id, isAdmin: true };
  owner = { userId: o.id, isAdmin: false };
  dev = { userId: d.id, isAdmin: false };
  const project = createProjectModule({ db: tdb.db, identity: identity.api, hosts, settings: { defaultMaxConcurrentTasks: 3, defaultServicePlan: 'standard-small' } });
  await project.api.upsertServicePlan(admin, { name: 'standard-small', cpu: '500m', memory: '512Mi', maxReplicas: 3, description: '' });
  projectId = (await project.api.createProject(admin, { slug: 'demo', name: '演示', kind: 'DigitalWorker', ownerUserId: owner.userId, template: 'minimal-sample' })).id;
  otherProjectId = (await project.api.createProject(admin, { slug: 'other', name: '其他', kind: 'DigitalWorker', ownerUserId: owner.userId, template: 'minimal-sample' })).id;
  await project.api.setMember(owner, projectId, { userId: dev.userId, role: 'developer' });
  egress = createEgressModule({ db: tdb.db, project: project.api });
});
afterAll(async () => { await tdb?.drop(); });

describe.skipIf(!available)('egress module', () => {
  let projectEntryId: string;

  test('管理员维护全局与项目级条目；作用域与 projectId 一致；重复冲突；非管理员被拒', async () => {
    const global = await egress.api.addEntry(admin, { fqdn: 'registry.npmjs.org', scope: 'global' });
    expect(global).toMatchObject({ fqdn: 'registry.npmjs.org', scope: 'global', createdBy: admin.userId });
    expect(global).not.toHaveProperty('projectId');
    const scoped = await egress.api.addEntry(admin, { fqdn: '*.internal.example.com', scope: 'project', projectId, note: '内网' });
    projectEntryId = scoped.id;
    expect(scoped).toMatchObject({ scope: 'project', projectId, note: '内网' });
    await egress.api.addEntry(admin, { fqdn: 'only.other.example.com', scope: 'project', projectId: otherProjectId });
    await expect(egress.api.addEntry(admin, { fqdn: 'registry.npmjs.org', scope: 'global' })).rejects.toMatchObject({ kind: 'conflict' });
    await expect(egress.api.addEntry(owner, { fqdn: 'x.example.com', scope: 'global' })).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(egress.api.addEntry(admin, { fqdn: 'x.example.com', scope: 'project' })).rejects.toMatchObject({ kind: 'validation' });
    await expect(egress.api.addEntry(admin, { fqdn: 'x.example.com', scope: 'global', projectId })).rejects.toMatchObject({ kind: 'validation' });
    await expect(egress.api.addEntry(admin, { fqdn: 'Bad_Host', scope: 'global' })).rejects.toMatchObject({ kind: 'validation' });
  });

  test('成员看到全局＋本项目条目；非成员 404；不带 projectId 只有管理员可用；policyFor 去重合并', async () => {
    expect((await egress.api.listEntries(admin)).map((e) => e.fqdn)).toEqual(['registry.npmjs.org', '*.internal.example.com', 'only.other.example.com']);
    expect((await egress.api.listEntries(dev, projectId)).map((e) => e.fqdn)).toEqual(['registry.npmjs.org', '*.internal.example.com']);
    expect((await egress.api.listEntries(admin, otherProjectId)).map((e) => e.fqdn)).toEqual(['registry.npmjs.org', 'only.other.example.com']);
    await expect(egress.api.listEntries(dev)).rejects.toMatchObject({ kind: 'validation' });
    await expect(egress.api.listEntries(stranger, projectId)).rejects.toMatchObject({ kind: 'not_found' });
    await expect(egress.api.listEntries(dev, otherProjectId)).rejects.toMatchObject({ kind: 'not_found' });
    expect(await egress.api.policyFor(projectId)).toEqual({ allow: ['*.internal.example.com', 'registry.npmjs.org'] });
    expect(await egress.api.policyFor(otherProjectId)).toEqual({ allow: ['only.other.example.com', 'registry.npmjs.org'] });
  });

  test('开发者申请追加：已放行或重复待裁定被拒；管理员批准即生成项目级条目；拒绝不改清单；不能二次裁定', async () => {
    const request = await egress.api.requestEntry(dev, projectId, { fqdn: 'api.github.com', reason: '拉取依赖' });
    expect(request).toMatchObject({ state: 'pending', fqdn: 'api.github.com', reason: '拉取依赖', requestedBy: dev.userId, projectId });
    await expect(egress.api.requestEntry(dev, projectId, { fqdn: 'api.github.com' })).rejects.toMatchObject({ kind: 'conflict' });
    await expect(egress.api.requestEntry(dev, projectId, { fqdn: 'registry.npmjs.org' })).rejects.toMatchObject({ kind: 'precondition' });
    await expect(egress.api.requestEntry(dev, projectId, { fqdn: 'git.internal.example.com' })).rejects.toMatchObject({ kind: 'precondition' });
    await expect(egress.api.requestEntry(stranger, projectId, { fqdn: 'x.example.com' })).rejects.toMatchObject({ kind: 'not_found' });
    await expect(egress.api.decideRequest(owner, request.id, { approve: true })).rejects.toMatchObject({ kind: 'forbidden' });
    const approved = await egress.api.decideRequest(admin, request.id, { approve: true, decision: '同意' });
    expect(approved).toMatchObject({ state: 'approved', decidedBy: admin.userId, decision: '同意' });
    expect(approved.decidedAt).toBeDefined();
    expect((await egress.api.policyFor(projectId)).allow).toContain('api.github.com');
    expect((await egress.api.listEntries(dev, projectId)).find((e) => e.fqdn === 'api.github.com')).toMatchObject({ scope: 'project', projectId, note: '同意' });
    await expect(egress.api.decideRequest(admin, request.id, { approve: false })).rejects.toMatchObject({ kind: 'precondition' });
    const rejected = await egress.api.decideRequest(admin, (await egress.api.requestEntry(dev, projectId, { fqdn: 'evil.example.com' })).id, { approve: false, decision: '不允许' });
    expect(rejected).toMatchObject({ state: 'rejected', decision: '不允许' });
    expect((await egress.api.policyFor(projectId)).allow).not.toContain('evil.example.com');
    await expect(egress.api.decideRequest(admin, 'egq_nope', { approve: true })).rejects.toMatchObject({ kind: 'not_found' });
    expect((await egress.api.listRequests(admin)).map((r) => r.state)).toEqual(['approved', 'rejected']);
    expect((await egress.api.listRequests(dev, projectId)).map((r) => r.fqdn)).toEqual(['api.github.com', 'evil.example.com']);
    await expect(egress.api.listRequests(dev)).rejects.toMatchObject({ kind: 'validation' });
    await expect(egress.api.listRequests(stranger, projectId)).rejects.toMatchObject({ kind: 'not_found' });
  });

  test('删除条目后清单收回；不存在的条目 404', async () => {
    await egress.api.removeEntry(admin, projectEntryId);
    expect((await egress.api.policyFor(projectId)).allow).toEqual(['api.github.com', 'registry.npmjs.org']);
    await expect(egress.api.removeEntry(admin, projectEntryId)).rejects.toMatchObject({ kind: 'not_found' });
    await expect(egress.api.removeEntry(dev, 'x')).rejects.toMatchObject({ kind: 'forbidden' });
  });

  test('被阻请求按 (project, fqdn) 累加并保留最近来源；成员可见', async () => {
    await egress.api.recordBlocked(projectId, 'Blocked.Example.com', 'dev-session');
    const second = await egress.api.recordBlocked(projectId, 'blocked.example.com.', 'build');
    expect(second).toMatchObject({ projectId, fqdn: 'blocked.example.com', count: 2, source: 'build' });
    await egress.api.recordBlocked(otherProjectId, 'blocked.example.com');
    expect(await egress.api.listBlocked(dev, projectId)).toEqual([expect.objectContaining({ fqdn: 'blocked.example.com', count: 2, source: 'build' })]);
    expect(await egress.api.listBlocked(admin, otherProjectId)).toEqual([expect.objectContaining({ count: 1 })]);
    expect((await egress.api.listBlocked(admin, otherProjectId))[0]).not.toHaveProperty('source');
    await expect(egress.api.listBlocked(stranger, projectId)).rejects.toMatchObject({ kind: 'not_found' });
  });

  test('HTTP 路由：管理员维护、成员申请与查看、内部上报只接受服务身份', async () => {
    const app = createApp({ name: 'test' });
    for (const router of egress.http) app.route('/', router);
    const asUser = (id: UserId) => ({ [IDENTITY_HEADERS.userId]: id, 'content-type': 'application/json' });
    const created = await app.request('/v1/egress/entries', { method: 'POST', headers: asUser(admin.userId), body: JSON.stringify({ fqdn: 'pypi.org', scope: 'global' }) });
    expect(created.status).toBe(201);
    const entryId = (await created.json() as { id: string }).id;
    expect((await app.request('/v1/egress/entries', { method: 'POST', headers: asUser(dev.userId), body: JSON.stringify({ fqdn: 'x.example.com', scope: 'global' }) })).status).toBe(403);
    expect((await app.request('/v1/egress/entries', { method: 'POST', headers: asUser(admin.userId), body: JSON.stringify({ fqdn: 'UPPER.example.com', scope: 'global' }) })).status).toBe(400);
    const all = await app.request('/v1/egress/entries', { headers: asUser(admin.userId) });
    expect((await all.json() as { items: Array<{ fqdn: string }> }).items.map((e) => e.fqdn)).toContain('pypi.org');
    const mine = await app.request(`/v1/egress/entries?projectId=${projectId}`, { headers: asUser(dev.userId) });
    expect((await mine.json() as { items: Array<{ fqdn: string }> }).items.map((e) => e.fqdn)).toEqual(['pypi.org', 'registry.npmjs.org', 'api.github.com']);
    expect((await app.request('/v1/egress/entries', { headers: asUser(dev.userId) })).status).toBe(400);
    const requested = await app.request(`/v1/projects/${projectId}/egress/requests`, { method: 'POST', headers: asUser(dev.userId), body: JSON.stringify({ fqdn: 'cdn.example.net', reason: '字体' }) });
    expect(requested.status).toBe(201);
    const requestId = (await requested.json() as { id: string }).id;
    const decided = await app.request(`/v1/egress/requests/${requestId}/decision`, { method: 'POST', headers: asUser(admin.userId), body: JSON.stringify({ approve: true, decision: 'ok' }) });
    expect(await decided.json()).toMatchObject({ state: 'approved', decision: 'ok' });
    expect((await app.request(`/v1/egress/requests/${requestId}/decision`, { method: 'POST', headers: asUser(owner.userId), body: JSON.stringify({ approve: true }) })).status).toBe(403);
    const list = await app.request(`/v1/projects/${projectId}/egress/requests`, { headers: asUser(owner.userId) });
    expect((await list.json() as { items: unknown[] }).items).toHaveLength(3);
    const adminList = await app.request(`/v1/egress/requests?projectId=${projectId}`, { headers: asUser(admin.userId) });
    expect((await adminList.json() as { items: unknown[] }).items).toHaveLength(3);
    const report = await app.request('/internal/egress/blocked', { method: 'POST', headers: { [IDENTITY_HEADERS.sourceService]: 'platform/egress-proxy', 'content-type': 'application/json' }, body: JSON.stringify({ projectId, fqdn: 'denied.example.org', source: 'slot' }) });
    expect(report.status).toBe(202);
    expect(await report.json()).toMatchObject({ fqdn: 'denied.example.org', count: 1, source: 'slot' });
    expect((await app.request('/internal/egress/blocked', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId, fqdn: 'denied.example.org' }) })).status).toBe(401);
    expect((await app.request('/internal/egress/blocked', { method: 'POST', headers: asUser(admin.userId), body: JSON.stringify({ projectId, fqdn: 'denied.example.org' }) })).status).toBe(403);
    const blockedList = await app.request(`/v1/projects/${projectId}/egress/blocked`, { headers: asUser(dev.userId) });
    expect((await blockedList.json() as { items: Array<{ fqdn: string }> }).items.map((b) => b.fqdn)).toEqual(['blocked.example.com', 'denied.example.org']);
    expect((await app.request(`/v1/egress/entries/${entryId}`, { method: 'DELETE', headers: asUser(admin.userId) })).status).toBe(204);
    expect((await app.request(`/v1/egress/entries/${entryId}`, { method: 'DELETE', headers: asUser(admin.userId) })).status).toBe(404);
    expect((await app.request('/v1/egress/entries')).status).toBe(401);
  });
});
