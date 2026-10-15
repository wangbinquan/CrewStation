import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { DeveloperAccessRequestDtoSchema, IDENTITY_HEADERS } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { createIdentityModule, identityMigrations } from '../wiring';

const available = await testDatabaseAvailable();
let db: TestDatabase;
beforeAll(async () => { if (available) db = await createTestDatabase([identityMigrations]); });
afterAll(async () => { await db?.drop(); });

describe.skipIf(!available)('开发者权限申请事务与授权', () => {
  test('请求绑定当前用户，重复提交只有一条；非管理员不能读审批列表或批准', async () => {
    const identity = createIdentityModule({ db: db.db, settings: { adminEmails: ['reviewer@test.invalid'] } });
    await identity.api.ensureUser({ externalId: 'reviewer', name: 'Reviewer', email: 'reviewer@test.invalid' });
    const user = await identity.api.ensureUser({ externalId: 'requester', name: 'Requester', email: 'requester@test.invalid' });
    const app = createApp({ name: 'developer-access-test' }); for (const route of identity.http.users) app.route('/', route);
    const headers = { [IDENTITY_HEADERS.userId]: user.id, 'content-type': 'application/json' };
    expect((await app.request('/v1/me/developer-access', { method: 'POST', headers, body: JSON.stringify({ reason: '创建周报助手', platformRole: 'admin' }) })).status).toBe(400);
    const send = async () => {
      const response = await app.request('/v1/me/developer-access', { method: 'POST', headers, body: JSON.stringify({ reason: '创建周报助手' }) });
      expect(response.status).toBe(201); return DeveloperAccessRequestDtoSchema.parse(await response.json());
    };
    const [a, b] = await Promise.all([send(), send()]);
    expect(a.id).toBe(b.id); expect(a.state).toBe('pending');
    expect(await (await app.request('/v1/me/developer-access', { headers })).json()).toMatchObject({ request: { id: a.id } });
    expect((await app.request('/v1/admin/developer-access', { headers })).status).toBe(403);
    expect((await app.request(`/v1/admin/developer-access/${a.id}/review`, { method: 'POST', headers, body: JSON.stringify({ decision: 'approved', expectedRevision: 1, note: 'approve myself' }) })).status).toBe(403);
    expect((await identity.api.getUser(user.id))?.platformRole).toBe('user');
  });

  test('管理员批准原子授予 developer，重复审批冲突，不会授予 admin', async () => {
    const identity = createIdentityModule({ db: db.db, settings: { adminEmails: ['reviewer@test.invalid'] } });
    const admin = await identity.api.ensureUser({ externalId: 'reviewer', name: 'Reviewer', email: 'reviewer@test.invalid' });
    const user = await identity.api.ensureUser({ externalId: 'approved-user', name: 'Approved', email: 'approved@test.invalid' });
    const request = await identity.api.requestDeveloperAccess(user.id, { reason: '构建项目' });
    const app = createApp({ name: 'developer-access-review-test' }); for (const route of identity.http.users) app.route('/', route);
    const headers = { [IDENTITY_HEADERS.userId]: admin.id, 'content-type': 'application/json' };
    const page = await app.request('/v1/admin/developer-access?state=pending&limit=20', { headers }); expect(page.status).toBe(200);
    expect((await page.json() as { items: Array<{ id: string }> }).items.some(item => item.id === request.id)).toBe(true);
    const review = () => app.request(`/v1/admin/developer-access/${request.id}/review`, { method: 'POST', headers, body: JSON.stringify({ decision: 'approved', expectedRevision: 1, note: '允许开发' }) });
    const result = await Promise.all([review(), review()]);
    expect(result.map(item => item.status).sort()).toEqual([200, 409]);
    expect((await identity.api.getUser(user.id))?.platformRole).toBe('developer');
    expect((await identity.api.myDeveloperAccess(user.id)).request).toMatchObject({ state: 'approved', revision: 2, reviewerId: admin.id });
    await expect(identity.api.requestDeveloperAccess(user.id, { reason: 'again' })).rejects.toMatchObject({ kind: 'precondition' });
  });

  test('拒绝可重新申请；分页有界；审批记录失败时角色更新回滚', async () => {
    const identity = createIdentityModule({ db: db.db, settings: { adminEmails: ['reviewer@test.invalid'] } });
    const admin = await identity.api.ensureUser({ externalId: 'reviewer', name: 'Reviewer', email: 'reviewer@test.invalid' });
    const user = await identity.api.ensureUser({ externalId: 'rejected-user', name: 'Rejected', email: 'rejected@test.invalid' });
    const first = await identity.api.requestDeveloperAccess(user.id, { reason: '申请' });
    await identity.api.reviewDeveloperAccess(admin.id, first.id, { decision: 'rejected', expectedRevision: 1, note: '需要补充用途' });
    expect((await identity.api.getUser(user.id))?.platformRole).toBe('user');
    const second = await identity.api.requestDeveloperAccess(user.id, { reason: '完善后的用途' }); expect(second.id).not.toBe(first.id);
    const page = await identity.api.listDeveloperAccess(admin.id, { state: 'pending', limit: 1 }); expect(page.items).toHaveLength(1); expect(page.nextCursor).toBeDefined();
    const next = await identity.api.listDeveloperAccess(admin.id, { state: 'pending', limit: 1, cursor: page.nextCursor as typeof second.id }); expect(next.items[0]?.id).not.toBe(page.items[0]?.id);
    await db.db.execute(sql`ALTER TABLE identity.developer_access_requests ADD CONSTRAINT test_review_failure CHECK (note IS DISTINCT FROM 'force rollback')`);
    try { await expect(identity.api.reviewDeveloperAccess(admin.id, second.id, { decision: 'approved', expectedRevision: 1, note: 'force rollback' })).rejects.toBeDefined(); }
    finally { await db.db.execute(sql`ALTER TABLE identity.developer_access_requests DROP CONSTRAINT test_review_failure`); }
    expect((await identity.api.getUser(user.id))?.platformRole).toBe('user');
    expect((await identity.api.myDeveloperAccess(user.id)).request?.state).toBe('pending');
  });
});
