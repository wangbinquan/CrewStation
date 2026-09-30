import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Actor, ProjectId, UserId } from '@crewstation/contracts';
import { IDENTITY_HEADERS } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import { queueMigrations } from '@crewstation/queue';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { resourceAccessMigrations } from '../wiring';
import { applyResourceChange } from '../application/applyChange';
import { resourceFixture } from './resourceFixtures';

const available = await testDatabaseAvailable();
let db: TestDatabase;
beforeAll(async () => { if (available) db = await createTestDatabase([queueMigrations, resourceAccessMigrations]); });
afterAll(async () => { await db?.drop(); });
const heartbeat = async () => true;
const headers = (actor: Actor) => ({ [IDENTITY_HEADERS.userId]: actor.userId, 'content-type': 'application/json' });

describe.skipIf(!available)('资源中心持久申请、权限与生效回执', () => {
  test('明确开放目录才可申请；开发者只读，伪造管理员标记无效', async () => {
    const f = resourceFixture(db.db), { api } = f.mod;
    expect(await api.targets(f.actors.owner, f.projectId, f.target.resourceType)).toEqual([]);
    await expect(api.create(f.actors.owner, f.projectId, f.input())).rejects.toMatchObject({ kind: 'forbidden' });
    await f.open();
    expect((await api.targets(f.actors.developer, f.projectId, f.target.resourceType))[0]?.actions).toEqual([]);
    await expect(api.create(f.actors.developer, f.projectId, f.input())).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(api.create(f.actors.admin, f.projectId, f.input())).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(api.direct({ ...f.actors.owner, isAdmin: true }, f.projectId, f.input())).rejects.toMatchObject({ kind: 'forbidden' });
    const request = await api.create(f.actors.owner, f.projectId, f.input());
    expect(request).toMatchObject({ state: 'pending', origin: 'owner-request', approvedValues: null }); expect(f.writes()).toBe(0);
  });

  test('幂等重放不重复写，内容变化拒绝；并发同一目标只受理一笔', async () => {
    const f = resourceFixture(db.db); await f.open();
    const input = f.input(), first = await f.mod.api.create(f.actors.owner, f.projectId, input);
    expect((await f.mod.api.create(f.actors.owner, f.projectId, input)).id).toBe(first.id);
    await expect(f.mod.api.create(f.actors.owner, f.projectId, { ...input, reason: '不同的申请内容' })).rejects.toMatchObject({ kind: 'conflict' });
    await f.mod.api.cancel(f.actors.owner, f.projectId, first.id, first.version);
    const results = await Promise.allSettled([f.input(), f.input()].map((i) => f.mod.api.create(f.actors.owner, f.projectId, i)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1); expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: { kind: 'conflict' } });
  });

  test('批准保留申请原值与调整理由；旧版本和旧资源修订均不能覆盖', async () => {
    const f = resourceFixture(db.db); await f.open();
    f.changeView({ current: { limit: 2 }, fields: [{ key: 'limit', label: '配额', type: 'number', min: 1, max: 10, integer: true, required: true }] });
    const request = await f.mod.api.create(f.actors.owner, f.projectId, { ...f.input(), values: { limit: 5 } });
    const decision = { expectedVersion: 1, approve: true, expectedRevision: 'r1', values: { limit: 4 }, reason: '容量评估后批准四单位' };
    await expect(f.mod.api.decide(f.actors.developer, f.projectId, request.id, decision)).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(f.mod.api.decide(f.actors.admin, f.projectId, request.id, { ...decision, expectedRevision: 'obsolete' })).rejects.toMatchObject({ kind: 'conflict' });
    const results = await Promise.allSettled([decision, decision].map((i) => f.mod.api.decide(f.actors.admin, f.projectId, request.id, i)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const approved = await f.mod.api.get(f.actors.owner, f.projectId, request.id);
    expect(approved).toMatchObject({ state: 'approved', requestedValues: { limit: 5 }, approvedValues: { limit: 4 }, decisionReason: decision.reason });
    await expect(f.mod.api.cancel(f.actors.owner, f.projectId, request.id, approved.version)).rejects.toMatchObject({ kind: 'precondition' });
    expect(await applyResourceChange(f.deps, request.id, heartbeat)).toBe(true);
    expect(await f.mod.api.get(f.actors.owner, f.projectId, request.id)).toMatchObject({ state: 'applied', effect: '已验证实际供给' }); expect(f.writes()).toBe(1);
  });

  test('目录、负责人身份、资源修订或归档状态变化，应用前再次校验且不写资源', async () => {
    for (const change of ['catalog', 'owner', 'revision', 'archive'] as const) {
      const f = resourceFixture(db.db); await f.open(); const request = await f.mod.api.create(f.actors.owner, f.projectId, f.input());
      await f.mod.api.decide(f.actors.admin, f.projectId, request.id, { expectedVersion: 1, approve: true, expectedRevision: 'r1', reason: '同意申请' });
      if (change === 'catalog') await f.mod.api.saveCatalogPolicy(f.actors.admin, f.projectId, f.target, { expectedRevision: 1, requestable: false });
      if (change === 'owner') f.roles.set(f.actors.owner.userId, 'developer');
      if (change === 'revision') f.changeView({ revision: 'r3' });
      if (change === 'archive') f.setActive(false);
      await applyResourceChange(f.deps, request.id, heartbeat);
      expect(await f.mod.api.get(f.actors.admin, f.projectId, request.id)).toMatchObject({ state: 'needs-review' }); expect(f.writes()).toBe(0);
    }
  });

  test('响应在领域提交后丢失可恢复回执；实际供给未就绪不重复调整', async () => {
    const f = resourceFixture(db.db); f.setCrash(); f.setObserved(false);
    const request = await f.mod.api.direct(f.actors.admin, f.projectId, f.input()); await applyResourceChange(f.deps, request.id, heartbeat);
    const failed = await f.mod.api.get(f.actors.admin, f.projectId, request.id); expect(failed.state).toBe('apply-failed'); expect(f.writes()).toBe(1);
    await f.mod.api.retry(f.actors.admin, f.projectId, request.id, failed.version);
    expect(await applyResourceChange(f.deps, request.id, heartbeat)).toBe(false); expect(await applyResourceChange(f.deps, request.id, heartbeat)).toBe(false);
    f.setObserved(true); expect(await applyResourceChange(f.deps, request.id, heartbeat)).toBe(true); expect(f.writes()).toBe(1);
    expect((await f.mod.api.get(f.actors.admin, f.projectId, request.id)).state).toBe('applied');
  });

  test('跨项目隔离与游标分页；配额无效数值不受理', async () => {
    const f = resourceFixture(db.db); await f.open();
    f.changeView({ current: { limit: 2 }, fields: [{ key: 'limit', label: '配额', type: 'number', min: 1, max: 10, integer: true, required: true }] });
    for (const value of [0, 11, 1.5, '3']) await expect(f.mod.api.create(f.actors.owner, f.projectId, { ...f.input(), values: { limit: value } })).rejects.toMatchObject({ kind: 'validation' });
    for (let i = 0; i < 3; i++) { const r = await f.mod.api.create(f.actors.owner, f.projectId, { ...f.input(), values: { limit: 3 } }); await f.mod.api.cancel(f.actors.owner, f.projectId, r.id, r.version); }
    const first = await f.mod.api.list(f.actors.owner, f.projectId, { limit: 2 }); expect(first.items).toHaveLength(2); expect(first.nextCursor).not.toBeNull();
    const second = await f.mod.api.list(f.actors.owner, f.projectId, { limit: 2, cursor: first.nextCursor! }); expect(second.items).toHaveLength(1);
    expect(new Set([...first.items, ...second.items].map((r) => r.id)).size).toBe(3);
    await expect(f.mod.api.get(f.actors.admin, Bun.randomUUIDv7() as ProjectId, first.items[0]!.id)).rejects.toMatchObject({ kind: 'not_found' });
  });

  test('HTTP 受理、审核、直接调整和严格鉴权输入；读结果无缓存', async () => {
    const isolated = await createTestDatabase([queueMigrations, resourceAccessMigrations]);
    try {
    const f = resourceFixture(isolated.db); await f.open(); const a = createApp({ name: 'resource-test' }); f.mod.http.forEach((r) => a.route('/', r));
    const base = `/v1/projects/${f.projectId}/resource-center`, post = (path: string, actor: Actor, body: unknown) => a.request(`${base}${path}`, { method: 'POST', headers: headers(actor), body: JSON.stringify(body) });
    expect((await a.request(`${base}/requests`)).status).toBe(401); expect((await post('/requests', f.actors.developer, f.input())).status).toBe(403);
    expect((await post('/direct', f.actors.owner, f.input())).status).toBe(403); expect((await post('/requests', f.actors.owner, { ...f.input(), unknown: true })).status).toBe(400);
    expect((await post('/inspect', { userId: Bun.randomUUIDv7() as UserId, isAdmin: false }, f.target)).status).toBe(404);
    const created = await post('/requests', f.actors.owner, f.input()); expect(created.status).toBe(202); const request = await created.json() as { id: string };
    expect((await post(`/requests/${request.id}/decision`, f.actors.admin, { expectedVersion: 1, approve: false, expectedRevision: 'r1', reason: '需求待完善' })).status).toBe(200);
    const read = await a.request(`${base}/requests`, { headers: headers(f.actors.developer) }); expect(read.status).toBe(200); expect(read.headers.get('cache-control')).toContain('no-store');
    expect((await post('/direct', f.actors.admin, f.input())).status).toBe(202); await f.mod.runOnce(); expect(f.writes()).toBe(1);
    } finally { await isolated.drop(); }
  });
});
