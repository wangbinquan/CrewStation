import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { ProjectId, ServiceId, TaskId, UserDto } from '@crewstation/contracts';
import { IDENTITY_HEADERS, TOKEN_CLAIMS } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { createApp, requireUser } from '@crewstation/http';
import { verifyWithJwks } from '@crewstation/jwt';
import type { Clock } from '@crewstation/kernel';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { DEV_SESSION_TOKEN_TTL_SECONDS } from '../domain/devSessionToken';
import type { IdentityModule } from '../wiring';
import { createIdentityModule, identityMigrations } from '../wiring';
import { BASE_SETTINGS, completeBootstrap, loginWithPassword, seedLocalUser } from './identityFixture';

const available = await testDatabaseAvailable();
const taskId = 'tsk_0123456789abcdef0123456789abcdef' as TaskId;
const projectId = 'prj_0123456789abcdef0123456789abcdef' as ProjectId;
const otherProjectId = 'prj_1123456789abcdef0123456789abcdef' as ProjectId;
const serviceId = 'svc_0123456789abcdef0123456789abcdef' as ServiceId;
const otherServiceId = 'svc_1123456789abcdef0123456789abcdef' as ServiceId;

let now = new Date('2026-09-12T09:00:00Z');
const clock: Clock = { now: () => new Date(now) };
/** 可改的“会话现状”：模拟释放（undefined）与换了别的项目两种情况。 */
let session: { projectId: ProjectId } | undefined = { projectId };

let tdb: TestDatabase;
let identity: IdentityModule;
let alice: UserDto;
let app: Hono<AppEnv>;

/** 与 cs-api 同序装配：createApp 的身份头中间件在前，devSessionGate 紧随其后，业务路由最后。 */
function mountAuth(module: IdentityModule): Hono<AppEnv> {
  const hono = createApp({ name: 'test-auth' });
  for (const router of module.http.auth) hono.route('/', router);
  return hono;
}

function mount(module: IdentityModule): Hono<AppEnv> {
  const hono = createApp({ name: 'test-api' });
  for (const router of module.http.devSessionGate) hono.route('/', router);
  const probe = new Hono<AppEnv>();
  const echo = (c: Context<AppEnv>) => c.json(requireUser(c));
  probe.get('/v1/projects', echo);
  probe.get('/v1/projects/:projectId/branches', echo);
  probe.put('/v1/projects/:projectId/members', echo);
  probe.get('/v1/services/:serviceId/slots', echo);
  probe.get('/v1/catalog/operations', echo);
  hono.route('/', probe);
  return hono;
}

async function issue(binding = { taskId, projectId, serviceId, userId: alice.id }): Promise<string> {
  return (await identity.api.issueDevSessionToken(binding)).token;
}

async function call(path: string, token: string, method = 'GET'): Promise<Response> {
  return app.request(path, { method, headers: { [IDENTITY_HEADERS.devSessionToken]: token, [IDENTITY_HEADERS.sourceService]: 'demo/demo' } });
}

beforeAll(async () => {
  if (!available) return;
  tdb = await createTestDatabase([identityMigrations]);
  identity = createIdentityModule({
    db: tdb.db,
    clock,
    settings: BASE_SETTINGS,
    devSessionState: { activeSession: async (id) => (id === taskId ? session : undefined) },
  });
  await completeBootstrap(tdb.db);
  await seedLocalUser(tdb.db, { username: 'alice', name: 'Alice', email: 'alice@example.com' });
  alice = (await identity.api.findByEmail('alice@example.com'))!;
  app = mount(identity);
});
afterAll(async () => { await tdb?.drop(); });

describe.skipIf(!available)('开发会话令牌', () => {
  test('签发的令牌声明绑死会话、项目、服务与用户，并自带 4 小时有效期', async () => {
    const issued = await identity.api.issueDevSessionToken({ taskId, projectId, serviceId, userId: alice.id });
    const verified = await verifyWithJwks(issued.token, await identity.api.jwks(), { audience: TOKEN_CLAIMS.audienceDevSession, issuer: TOKEN_CLAIMS.issuer, currentDate: now });
    expect(verified.subject).toBe(`${TOKEN_CLAIMS.subjectPrefixUser}${alice.id}`);
    expect(verified.claims[TOKEN_CLAIMS.kind]).toBe(TOKEN_CLAIMS.kindDevSession);
    expect(verified.claims[TOKEN_CLAIMS.taskId]).toBe(taskId);
    expect(verified.claims[TOKEN_CLAIMS.project]).toBe(projectId);
    expect(verified.claims[TOKEN_CLAIMS.service]).toBe(serviceId);
    expect(verified.expiresAt - verified.issuedAt).toBe(DEV_SESSION_TOKEN_TTL_SECONDS);
    expect(issued.expiresAt).toBe(new Date(now.getTime() + DEV_SESSION_TOKEN_TTL_SECONDS * 1000).toISOString());
  });

  test('校验通过时给出会话所属用户与绑定；伪造与换受众的令牌一律拒绝', async () => {
    const resolved = await identity.api.resolveDevSessionToken(await issue());
    expect(resolved).toMatchObject({ taskId, projectId, serviceId, userId: alice.id });
    expect(resolved?.user.email).toBe('alice@example.com');
    expect(await identity.api.resolveDevSessionToken('not-a-token')).toBeUndefined();
    // 浏览器会话 Cookie 的 aud 是 session，不能拿来当开发会话令牌用。
    const loginApp = mountAuth(identity);
    const { cookie } = await loginWithPassword(loginApp, identity, 'alice');
    expect(await identity.api.resolveDevSessionToken(cookie)).toBeUndefined();
  });

  test('过期后自行失效，不续期', async () => {
    const token = await issue();
    now = new Date(now.getTime() + (DEV_SESSION_TOKEN_TTL_SECONDS + 60) * 1000);
    expect(await identity.api.resolveDevSessionToken(token)).toBeUndefined();
    now = new Date('2026-09-12T09:00:00Z');
    expect(await identity.api.resolveDevSessionToken(token)).toBeDefined();
  });

  test('会话释放后立即失效，不等过期；会话换了项目也失效', async () => {
    const token = await issue();
    session = undefined;
    expect(await identity.api.resolveDevSessionToken(token)).toBeUndefined();
    expect((await call(`/v1/projects/${projectId}/branches`, token)).status).toBe(401);
    session = { projectId: otherProjectId };
    expect(await identity.api.resolveDevSessionToken(token)).toBeUndefined();
    session = { projectId };
  });

  test('cs-api 上令牌改判为用户身份，只在本项目本服务内有效', async () => {
    const token = await issue();
    const ok = await call(`/v1/projects/${projectId}/branches`, token);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ kind: 'user', userId: alice.id, devSession: { taskId, projectId, serviceId } });
    expect((await call('/v1/projects', token)).status).toBe(200);
    expect((await call(`/v1/services/${serviceId}/slots`, token)).status).toBe(200);
    expect((await call(`/v1/catalog/operations?serviceId=${serviceId}`, token)).status).toBe(200);
  });

  test('越出本项目、本服务或白名单的调用一律 403，错误形状与平台一致', async () => {
    const token = await issue();
    const other = await call(`/v1/projects/${otherProjectId}/branches`, token);
    expect(other.status).toBe(403);
    expect(await other.json()).toMatchObject({ error: 'forbidden' });
    expect((await call(`/v1/services/${otherServiceId}/slots`, token)).status).toBe(403);
    expect((await call('/v1/catalog/operations', token)).status).toBe(403);
    expect((await call(`/v1/catalog/operations?serviceId=${otherServiceId}`, token)).status).toBe(403);
    // 白名单之外的接口（成员管理）即使在本项目内也不给。
    expect((await call(`/v1/projects/${projectId}/members`, token, 'PUT')).status).toBe(403);
  });

  test('未装配会话现状查询时一律拒绝（失败即关门）', async () => {
    const bare = createIdentityModule({ db: tdb.db, clock, settings: BASE_SETTINGS });
    const token = (await bare.api.issueDevSessionToken({ taskId, projectId, serviceId, userId: alice.id })).token;
    expect(await bare.api.resolveDevSessionToken(token)).toBeUndefined();
  });
});
