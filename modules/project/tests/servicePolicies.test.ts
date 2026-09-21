import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { BUILTIN_RESOURCES, IDENTITY_HEADERS } from '@crewstation/contracts';
import type { Actor, ProjectId, ProjectServicePolicy, UserDto, UserId } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { createApp } from '@crewstation/http';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { createProjectModule, projectMigrations } from '../wiring';
import type { ProjectModule } from '../wiring';

const available = await testDatabaseAvailable();
const admin: Actor = { userId: Bun.randomUUIDv7() as UserId, isAdmin: true };
const member: Actor = { userId: Bun.randomUUIDv7() as UserId, isAdmin: false };
const stranger: Actor = { userId: Bun.randomUUIDv7() as UserId, isAdmin: false };
const inherited: ProjectServicePolicy = { mode: 'inherit', allowedPlanIds: [] };
const small = BUILTIN_RESOURCES.servicePlanSmall;
let db: TestDatabase, mod: ProjectModule, large: string, sequence = 0;
const users = new Map<UserId, UserDto>([admin, member, stranger].map((actor) => [actor.userId, { id: actor.userId, name: 'Tester', email: `${actor.userId}@test.invalid`, platformRole: actor.isAdmin ? 'admin' : 'developer', isAdmin: actor.isAdmin }]));
const headers = (actor: Actor) => ({ [IDENTITY_HEADERS.userId]: actor.userId, 'content-type': 'application/json' });
const create = async () => (await mod.api.createProject(admin, { slug: `resources-${++sequence}`, name: '资源项目', kind: 'DigitalWorker', template: BUILTIN_RESOURCES.minimalTemplate, ownerUserId: member.userId })).id;
const restricted = (allowedPlanIds: string[]): ProjectServicePolicy => ({ mode: 'restricted', allowedPlanIds });
const app = () => { const a = createApp({ name: 'service-policy-test' }); for (const router of mod.http) a.route('/', router); return a; };

beforeAll(async () => {
  if (!available) return;
  db = await createTestDatabase([eventbusMigrations, projectMigrations]);
  mod = createProjectModule({ db: db.db, identity: { isAdmin: async (id) => id === admin.userId, getUser: async (id) => users.get(id), findByEmail: async () => undefined },
    hosts: { prodHost: String, previewHost: String, serviceHost: String }, taskUsage: { runningTasks: async () => 4 }, settings: { defaultMaxConcurrentTasks: 3, defaultServicePlan: small } });
  large = (await mod.api.createServicePlan(admin, { name: 'large', cpu: '2', memory: '4Gi', maxReplicas: 5, description: '' })).id;
});
afterAll(async () => { await db?.drop(); });

describe.skipIf(!available)('项目资源政策与并发配额', () => {
  test('未配置继承全部目录；两项目独立分配，空清单阻止后续部署，恢复继承重新可用', async () => {
    const a = await create(), b = await create();
    expect(await mod.api.getServicePolicy(member, a)).toEqual({ projectId: a, revision: 0, policy: inherited, updatedAt: null });
    expect((await mod.api.resolveProjectServicePlan(a, large))?.id).toBe(large);
    expect((await mod.api.listProjectServicePlans(member, a)).map((plan) => plan.id)).toContain(large);
    expect(await mod.api.saveServicePolicy(admin, a, { expectedRevision: 0, policy: restricted([small]) })).toMatchObject({ revision: 1 });
    expect((await mod.api.listProjectServicePlans(member, a)).map((plan) => plan.id)).toEqual([small]);
    await expect(mod.api.resolveProjectServicePlan(a, large)).rejects.toMatchObject({ kind: 'forbidden', details: { projectId: a, planId: large } });
    expect((await mod.api.resolveProjectServicePlan(b, large))?.id).toBe(large);
    await mod.api.saveServicePolicy(admin, a, { expectedRevision: 1, policy: restricted([]) });
    await expect(mod.api.resolveProjectServicePlan(a, small)).rejects.toMatchObject({ kind: 'forbidden' });
    await mod.api.saveServicePolicy(admin, a, { expectedRevision: 2, policy: inherited });
    expect((await mod.api.resolveProjectServicePlan(a, small))?.id).toBe(small);
    expect(await mod.api.resolveProjectServicePlan(a, Bun.randomUUIDv7())).toBeUndefined();
  });

  test('服务政策校验资源和项目，拒绝成员写入及非成员读取，不留下失败记录', async () => {
    const id = await create(), missing = Bun.randomUUIDv7() as ProjectId;
    await expect(mod.api.saveServicePolicy(admin, id, { expectedRevision: 0, policy: restricted([Bun.randomUUIDv7()]) })).rejects.toMatchObject({ kind: 'validation', details: { field: 'allowedPlanIds' } });
    await expect(mod.api.saveServicePolicy(member, id, { expectedRevision: 0, policy: inherited })).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(mod.api.getServicePolicy(stranger, id)).rejects.toMatchObject({ kind: 'not_found' });
    await expect(mod.api.getServicePolicy(admin, missing)).rejects.toMatchObject({ kind: 'not_found' });
    await expect(mod.api.saveServicePolicy(admin, missing, { expectedRevision: 0, policy: inherited })).rejects.toMatchObject({ kind: 'not_found' });
    await expect(mod.api.resolveProjectServicePlan(missing, small)).rejects.toMatchObject({ kind: 'not_found' });
    expect((await mod.api.getServicePolicy(admin, id)).revision).toBe(0);
  });

  test('首次与更新的相同版本并发保存只有一笔成功；旧版本不能覆盖', async () => {
    const id = await create();
    for (const expectedRevision of [0, 1]) {
      const results = await Promise.allSettled([inherited, restricted([large])].map((policy) => mod.api.saveServicePolicy(admin, id, { expectedRevision, policy })));
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: { kind: 'conflict' } });
    }
    expect((await mod.api.getServicePolicy(admin, id)).revision).toBe(2);
  });

  test('真实 HTTP 的成功读写、401、403、404、400 与 409，响应不缓存', async () => {
    const id = await create(), a = app(), url = `/v1/projects/${id}/service-policy`;
    const put = (actor: Actor, body: unknown) => a.request(url, { method: 'PUT', headers: headers(actor), body: JSON.stringify(body) });
    expect((await a.request(url)).status).toBe(401);
    expect((await a.request(url, { headers: headers(stranger) })).status).toBe(404);
    const read = await a.request(url, { headers: headers(member) }); expect(read.status).toBe(200); expect(read.headers.get('cache-control')).toContain('no-store');
    expect((await put(member, { expectedRevision: 0, policy: inherited })).status).toBe(403);
    expect((await put(admin, { expectedRevision: 0, policy: { ...inherited, unknown: true } })).status).toBe(400);
    expect((await put(admin, { expectedRevision: 0, policy: restricted([large]) })).status).toBe(200);
    expect((await put(admin, { expectedRevision: 0, policy: inherited })).status).toBe(409);
    expect(await (await a.request(url, { headers: headers(member) })).json()).toMatchObject({ revision: 1, policy: restricted([large]) });
  });

  test('降低配额仍返回真实占用；同时比较旧值只有一笔成功，旧客户端仍可写', async () => {
    const id = await create();
    expect(await mod.api.getQuota(member, id)).toEqual({ maxConcurrentTasks: 3, running: 4 });
    const results = await Promise.allSettled([1, 5].map((maxConcurrentTasks) => mod.api.setQuota(admin, id, { maxConcurrentTasks, expectedMaxConcurrentTasks: 3 })));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: { kind: 'conflict' } });
    expect(await mod.api.setQuota(admin, id, { maxConcurrentTasks: 1 })).toEqual({ maxConcurrentTasks: 1, running: 4 });
    await expect(mod.api.setQuota(member, id, { maxConcurrentTasks: 2 })).rejects.toMatchObject({ kind: 'forbidden' });
    const a = app(), url = `/v1/projects/${id}/quota`;
    for (const value of [0, 101, 1.5]) expect((await a.request(url, { method: 'PUT', headers: headers(admin), body: JSON.stringify({ maxConcurrentTasks: value }) })).status).toBe(400);
    const response = await a.request(url, { method: 'PUT', headers: headers(admin), body: JSON.stringify({ maxConcurrentTasks: 2, expectedMaxConcurrentTasks: 1 }) });
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ maxConcurrentTasks: 2, running: 4 });
  });
});
