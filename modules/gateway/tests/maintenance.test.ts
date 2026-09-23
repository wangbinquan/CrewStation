import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Actor, ProjectId, ServiceId, UserId, WorkloadIdentity } from '@crewstation/contracts';
import { IDENTITY_HEADERS } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { createApp } from '@crewstation/http';
import { createFakeK8sClient } from '@crewstation/k8s';
import { forbidden, notFound } from '@crewstation/kernel';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import type { GatewayModule } from '../wiring';
import { createGatewayModule, gatewayMigrations } from '../wiring';

const available = await testDatabaseAvailable();
let tdb: TestDatabase;
let gateway: GatewayModule;

const demoId = '01a0bf5d-8f4b-76c5-866c-f1feda3d6301' as ServiceId, issuesId = '01a0bf5d-8f4b-7549-872a-18d62f6a1f02' as ServiceId;
const demoProject = '01a0bf5d-8f4b-7b10-9a12-5e7d8c4b3a03' as ProjectId, issuesProject = '01a0bf5d-8f4b-7b11-b833-6f8e9d5c4b04' as ProjectId;
const services = [
  { serviceId: demoId, projectId: demoProject, projectSlug: 'demo', serviceName: 'demo', namespace: 'cs-demo', identity: 'demo/demo', kind: 'DigitalWorker' as const, archived: false },
  { serviceId: issuesId, projectId: issuesProject, projectSlug: 'issues', serviceName: 'issues', namespace: 'cs-issues', identity: 'issues/issues', kind: 'APIProxy' as const, archived: false },
];
const user = (n: number) => `01a0bf5d-8f4b-7210-80c1-302ae945b0${String(n).padStart(2, '0')}` as UserId;
const owner: Actor = { userId: user(1), isAdmin: false }, developer: Actor = { userId: user(2), isAdmin: false }, tester: Actor = { userId: user(3), isAdmin: false };
const admin: Actor = { userId: user(4), isAdmin: true }, stranger: Actor = { userId: user(5), isAdmin: false }, guest: Actor = { userId: user(6), isAdmin: false };
const members = new Map<UserId, string>([[owner.userId, 'owner'], [developer.userId, 'developer'], [tester.userId, 'tester']]);
const standby = new Map<ServiceId, { empty: boolean; offline?: { at: string; reason: 'idle'; tag: string } }>();
const noted: ServiceId[] = [];

function newGateway(): GatewayModule {
  return createGatewayModule({
    db: tdb.db, k8s: createFakeK8sClient(),
    services: { listServices: async () => services, getService: async (id) => services.find((s) => s.serviceId === id), serviceIdOfProject: async (p) => services.find((s) => s.projectId === p)?.serviceId },
    slots: { slotRoles: async () => ({ prod: 'blue', preview: 'green' }), standbyEntry: async (id) => standby.get(id) ?? { empty: false }, notePreviewAccess: async (id) => { noted.push(id); } },
    grants: {
      grantedOperations: async (caller) => ({
        operations: caller === 'demo/demo' ? ['01a0bf5d-8f4b-7155-8e96-d9844e02dfa1'] : [],
        defaultOpen: ['01a0bf5d-8f4b-73dc-813d-bb1eeb744392'],
        operationRoutes: [{ id: '01a0bf5d-8f4b-7155-8e96-d9844e02dfa1', proxy: 'issues', method: 'POST', path: '/v1/issues' }, { id: '01a0bf5d-8f4b-73dc-813d-bb1eeb744392', proxy: 'demo', method: 'GET', path: '/v1/things' }],
      }),
      listCallers: async () => [], proxyNameOf: async (id) => (id === issuesId ? 'issues' : undefined),
    },
    hosts: { prodHost: (s) => `${s}.cs.localhost`, previewHost: (s) => `preview.${s}.cs.localhost`, serviceHost: (s) => `${s}.svc.cs.internal`, platformApiHost: () => 'api.svc.cs.internal' },
    // 与 project 模块一致：非成员 404（项目不暴露），成员但不是负责人 403，管理员全部放行。
    access: {
      authorize: async (actor, _projectId, action) => {
        if (actor.isAdmin) return 'admin';
        const role = members.get(actor.userId);
        if (!role) throw notFound('项目', _projectId);
        if (action === 'manage-maintenance' && role !== 'owner') throw forbidden(`角色 ${role} 不能执行 ${action}`);
        return role;
      },
      isMemberOrAdmin: async (userId) => members.has(userId) || userId === admin.userId,
    },
    users: { describe: async (id) => (id === guest.userId ? { name: '业务方', email: 'guest@example.test' } : members.has(id) ? { name: `成员${id.slice(-2)}`, email: 'm@example.test' } : undefined) },
    isAdmin: async (id) => id === admin.userId,
    settings: { systemNamespace: 'crewstation-system', serviceDomain: 'svc.cs.internal', userAuthMiddleware: 'forward-auth-user', serviceAuthMiddleware: 'forward-auth-service', dropIdentityHeadersMiddleware: 'drop-identity-headers', allowlistMaxStaleSeconds: 300, consumerName: 'test.maintenance' },
  });
}

beforeAll(async () => {
  if (!available) return;
  tdb = await createTestDatabase([eventbusMigrations, gatewayMigrations]);
  gateway = newGateway();
  await gateway.api.rebuildAllowlist();
});
afterAll(async () => { await tdb?.drop(); });

const all = { users: true, services: true, events: true };
const events = async () => (await tdb.db.execute(sql`SELECT payload FROM platform_infra.domain_events WHERE topic = 'gateway.maintenance-changed' ORDER BY id`) as unknown as Array<{ payload: unknown }>).map((r) => (typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload) as { serviceId: string; active: boolean; holdEvents: boolean });

describe.skipIf(!available)('RFC-021 正式版本维护', () => {
  test('进入、调整、退出：版本号冲突拒绝，临时指定的人必须存在，记录与领域事件齐全；开发者 403、非成员 404', async () => {
    expect(await gateway.api.getMaintenance(developer, demoId)).toEqual({ current: null, history: [] });
    await expect(gateway.api.setMaintenance(developer, demoId, { switches: all, allowUserIds: [], reason: '修数据', expectedRevision: 0 })).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(gateway.api.getMaintenance(stranger, demoId)).rejects.toMatchObject({ kind: 'not_found' });
    await expect(gateway.api.setMaintenance(owner, demoId, { switches: all, allowUserIds: [stranger.userId], reason: '修数据', expectedRevision: 0 })).rejects.toMatchObject({ kind: 'validation', message: expect.stringContaining(stranger.userId) });
    const entered = await gateway.api.setMaintenance(owner, demoId, { switches: all, allowUserIds: [guest.userId], reason: '修数据', expectedEndAt: '2026-09-23T10:00:00.000Z', expectedRevision: 0 });
    expect(entered).toMatchObject({ revision: 1, switches: all, reason: '修数据', expectedEndAt: '2026-09-23T10:00:00.000Z', allowUsers: [{ userId: guest.userId, name: '业务方', email: 'guest@example.test' }], startedBy: owner.userId });
    await expect(gateway.api.setMaintenance(admin, demoId, { switches: all, allowUserIds: [], reason: '另一个', expectedRevision: 0 })).rejects.toMatchObject({ kind: 'conflict' });
    const adjusted = await gateway.api.setMaintenance(admin, demoId, { switches: { ...all, events: false }, allowUserIds: [], reason: '修数据（延长）', expectedEndAt: null, expectedRevision: 1 });
    expect(adjusted).toMatchObject({ revision: 2, startedBy: owner.userId, updatedBy: admin.userId, allowUsers: [] });
    expect(adjusted.expectedEndAt).toBeUndefined();
    await expect(gateway.api.exitMaintenance(owner, demoId, { expectedRevision: 1 })).rejects.toMatchObject({ kind: 'conflict' });
    const exited = await gateway.api.exitMaintenance(owner, demoId, { expectedRevision: 2 });
    expect(exited.current).toBeNull();
    expect(exited.history.map((e) => [e.kind, e.actorUserId])).toEqual([['exited', owner.userId], ['updated', admin.userId], ['entered', owner.userId]]);
    expect(await events()).toEqual([
      expect.objectContaining({ serviceId: demoId, active: true, holdEvents: true }),
      expect.objectContaining({ serviceId: demoId, active: true, holdEvents: false }),
      expect.objectContaining({ serviceId: demoId, active: false, holdEvents: false }),
    ]);
    await expect(gateway.api.exitMaintenance(owner, demoId, { expectedRevision: 3 })).rejects.toMatchObject({ kind: 'conflict', message: expect.stringContaining('已不在维护中') });
  });

  test('用户流量：维护中只放行成员、管理员与临时指定的人；被拦的人拿到原因与预计恢复时间；开关关着时照常', async () => {
    expect(await gateway.api.userEntry(stranger.userId, 'demo', 'prod')).toEqual({ kind: 'open' });
    const future = new Date(Date.now() + 2 * 3_600_000).toISOString();
    await gateway.api.setMaintenance(owner, demoId, { switches: all, allowUserIds: [guest.userId], reason: '修数据', expectedEndAt: future, expectedRevision: 0 });
    for (const actor of [owner, developer, tester, admin, guest]) expect(await gateway.api.userEntry(actor.userId, 'demo', 'prod')).toEqual({ kind: 'open' });
    const blocked = await gateway.api.userEntry(stranger.userId, 'demo', 'prod');
    expect(blocked).toMatchObject({ kind: 'maintenance', projectSlug: 'demo', reason: '修数据', expectedEndAt: future });
    expect(blocked.kind === 'maintenance' ? blocked.retryAfterSeconds : 0).toBeGreaterThan(3_500);
    expect(await gateway.api.userEntry(stranger.userId, 'issues', 'prod')).toEqual({ kind: 'open' });
    const revision = (await gateway.api.getMaintenance(owner, demoId)).current!.revision;
    await gateway.api.setMaintenance(owner, demoId, { switches: { ...all, users: false }, allowUserIds: [], reason: '只拦服务', expectedRevision: revision });
    expect(await gateway.api.userEntry(stranger.userId, 'demo', 'prod')).toEqual({ kind: 'open' });
    await gateway.api.exitMaintenance(owner, demoId, { expectedRevision: revision + 1 });
  });

  test('preview 入口：待命槽没有版本时是未部署页（带下线记录），有版本时放行并记一次访问', async () => {
    standby.set(demoId, { empty: true, offline: { at: '2026-09-23T01:00:00.000Z', reason: 'idle', tag: 'v0.1.2' } });
    expect(await gateway.api.userEntry(tester.userId, 'demo', 'preview')).toEqual({ kind: 'not-deployed', projectSlug: 'demo', offline: { at: '2026-09-23T01:00:00.000Z', reason: 'idle', tag: 'v0.1.2' } });
    expect(await gateway.api.userEntry(tester.userId, 'issues', 'preview')).toEqual({ kind: 'open' });
    expect(noted).toEqual([issuesId]);
    expect(await gateway.api.userEntry(tester.userId, 'no-such-project', 'preview')).toEqual({ kind: 'open' });
    standby.delete(demoId);
  });

  test('服务域：其他服务调用维护中的服务 503，项目自己的负载与平台组件照常；proxy 前缀同样生效；开关关着时照常', async () => {
    const other: WorkloadIdentity = { identity: 'issues/issues', project: 'issues', service: 'issues', kind: 'service', slot: 'prod' };
    const self: WorkloadIdentity = { identity: 'demo/demo', project: 'demo', service: 'demo', kind: 'dev-session' };
    const platform: WorkloadIdentity = { identity: 'crewstation/cs-events', project: 'crewstation', service: 'cs-events', kind: 'platform' };
    const toDemo = (caller: WorkloadIdentity) => gateway.api.evaluate(caller, { host: 'demo.svc.cs.internal', method: 'GET', path: '/v1/things' });
    expect((await toDemo(other)).allowed).toBe(true);
    await gateway.api.setMaintenance(owner, demoId, { switches: { users: false, services: true, events: false }, allowUserIds: [], reason: '换数据库', expectedRevision: 0 });
    expect(await toDemo(other)).toMatchObject({ allowed: false, unavailable: { message: expect.stringContaining('换数据库') } });
    expect((await toDemo(self)).allowed).toBe(true);
    expect((await toDemo(platform)).allowed).toBe(true);
    expect(await gateway.api.holdsEvents(demoId)).toBe(false);
    expect(await gateway.api.maintenanceWindowOpen(demoId)).toBe(false);
    await gateway.api.exitMaintenance(owner, demoId, { expectedRevision: 1 });
    expect((await toDemo(other)).allowed).toBe(true);

    const toIssues = () => gateway.api.evaluate(self, { host: 'api.svc.cs.internal', method: 'POST', path: '/api/issues/v1/issues' });
    expect((await toIssues()).allowed).toBe(true);
    await gateway.api.setMaintenance(admin, issuesId, { switches: all, allowUserIds: [], reason: '上游切换', expectedRevision: 0 });
    expect(await toIssues()).toMatchObject({ allowed: false, unavailable: { message: expect.stringContaining('上游切换') } });
    expect(await gateway.api.holdsEvents(issuesId)).toBe(true);
    expect(await gateway.api.maintenanceWindowOpen(issuesId)).toBe(true);
    expect(await gateway.api.maintenanceOf(issuesId)).toMatchObject({ reason: '上游切换', switches: all });
    await gateway.api.exitMaintenance(admin, issuesId, { expectedRevision: 1 });
    expect((await toIssues()).allowed).toBe(true);
  });

  test('HTTP：未登录 401、多余字段 400、开发者 403、非成员 404；进入、读取、退出的成功路径', async () => {
    const app = createApp({ name: 'maintenance-test' }); for (const r of gateway.http) app.route('/', r);
    const as = (actor: Actor) => ({ [IDENTITY_HEADERS.userId]: actor.userId, [IDENTITY_HEADERS.userName]: 'n', [IDENTITY_HEADERS.userEmail]: 'e@x', 'content-type': 'application/json' });
    const path = `/v1/services/${demoId}/maintenance`;
    const body = { switches: all, allowUserIds: [], reason: '演练', expectedRevision: 0 };
    expect((await app.request(path, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).status).toBe(401);
    expect((await app.request(path, { method: 'PUT', headers: as(owner), body: JSON.stringify({ ...body, force: true }) })).status).toBe(400);
    expect((await app.request(path, { method: 'PUT', headers: as(developer), body: JSON.stringify(body) })).status).toBe(403);
    expect((await app.request(path, { headers: as(stranger) })).status).toBe(404);
    const put = await app.request(path, { method: 'PUT', headers: as(owner), body: JSON.stringify(body) });
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ revision: 1, reason: '演练' });
    const read = await app.request(path, { headers: as(developer) });
    expect(read.status).toBe(200);
    expect(((await read.json()) as { current: { revision: number } }).current.revision).toBe(1);
    const exit = await app.request(`${path}/exit`, { method: 'POST', headers: as(owner), body: JSON.stringify({ expectedRevision: 1 }) });
    expect(exit.status).toBe(200);
    expect(((await exit.json()) as { current: unknown }).current).toBeNull();
  });
});
