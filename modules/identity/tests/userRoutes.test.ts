import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { ProjectId, UserId } from '@crewstation/contracts';
import { IDENTITY_HEADERS } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { createApp } from '@crewstation/http';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { Hono } from 'hono';
import type { IdentityModule } from '../wiring';
import { createIdentityModule, identityMigrations } from '../wiring';

const available = await testDatabaseAvailable();
const projectId = 'prj_0123456789abcdef0123456789abcdef' as ProjectId;
let tdb: TestDatabase;
let identity: IdentityModule;
let app: Hono<AppEnv>;
let adminId: UserId;
let memberId: UserId;

beforeAll(async () => {
  if (!available) return;
  tdb = await createTestDatabase([identityMigrations]);
  identity = createIdentityModule({
    db: tdb.db,
    settings: { adminEmails: ['admin@example.com'] },
    membershipLookup: { membershipsOf: async (userId) => (userId === memberId ? [{ projectId, role: 'developer' }] : []) },
  });
  app = createApp({ name: 'test' });
  for (const router of identity.http.users) app.route('/', router);
  adminId = (await identity.api.ensureUser({ externalId: 'oidc:admin', name: 'Admin', email: 'admin@example.com' })).id;
  memberId = (await identity.api.ensureUser({ externalId: 'oidc:idp:member', name: 'Member', email: 'member@example.com' })).id;
});
afterAll(async () => { await tdb?.drop(); });

describe.skipIf(!available)('user routes (cs-api)', () => {
  const asUser = (id: string) => ({ [IDENTITY_HEADERS.userId]: id });

  test('/v1/me：成员关系来自 MembershipLookup，认证方式来自平台内部头（缺省按密码）', async () => {
    const me = await app.request('/v1/me', { headers: asUser(memberId) });
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ id: memberId, name: 'Member', email: 'member@example.com', platformRole: 'user', isAdmin: false, memberships: [{ projectId, role: 'developer' }], authMethod: 'password' });
    expect(await (await app.request('/v1/me', { headers: { ...asUser(adminId), 'x-cs-auth-method': 'oidc' } })).json()).toMatchObject({ isAdmin: true, memberships: [], authMethod: 'oidc' });
    expect((await app.request('/v1/me')).status).toBe(401);
    expect((await app.request('/v1/me', { headers: asUser('usr_ffffffffffffffffffffffffffffffff') })).status).toBe(401);
  });

  test('用户目录与管理员标记只有管理员可用', async () => {
    expect((await app.request('/v1/users', { headers: asUser(memberId) })).status).toBe(403);
    const list = await app.request('/v1/users', { headers: asUser(adminId) });
    expect(((await list.json()) as { items: unknown[] }).items.length).toBe(2);
    const denied = await app.request(`/v1/users/${memberId}/admin`, { method: 'PUT', headers: { ...asUser(memberId), 'content-type': 'application/json' }, body: JSON.stringify({ isAdmin: true }) });
    expect(denied.status).toBe(403);
    const granted = await app.request(`/v1/users/${memberId}/admin`, { method: 'PUT', headers: { ...asUser(adminId), 'content-type': 'application/json' }, body: JSON.stringify({ isAdmin: true }) });
    expect(await granted.json()).toMatchObject({ id: memberId, isAdmin: true });
    expect(await identity.api.isAdmin(memberId)).toBe(true);
    const bad = await app.request(`/v1/users/${memberId}/admin`, { method: 'PUT', headers: { ...asUser(adminId), 'content-type': 'application/json' }, body: JSON.stringify({ isAdmin: 'yes' }) });
    expect(bad.status).toBe(400);
    const missing = await app.request('/v1/users/usr_ffffffffffffffffffffffffffffffff/admin', { method: 'PUT', headers: { ...asUser(adminId), 'content-type': 'application/json' }, body: JSON.stringify({ isAdmin: true }) });
    expect(missing.status).toBe(404);
  });
});
