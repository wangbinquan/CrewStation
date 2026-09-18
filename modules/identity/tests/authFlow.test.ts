import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { TOKEN_CLAIMS } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { verifyWithJwks } from '@crewstation/jwt';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { Hono } from 'hono';
import { drizzleLoginPolicyRepository } from '../adapters/persistence/drizzleOidcRepositories';
import type { IdentityModule } from '../wiring';
import { identityMigrations } from '../wiring';
import { BASE_SETTINGS, TEST_PASSWORD, identityModuleFor, loginWithPassword, mountRouters, seedLocalUser } from './identityFixture';

const available = await testDatabaseAvailable();
let tdb: TestDatabase;
let identity: IdentityModule;
let app: Hono<AppEnv>;

function cookieValue(res: Response): string {
  return /cs_session=([^;]*)/.exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
}

async function bootstrap(fields: Record<string, string>): Promise<Response> {
  return app.request('/auth/bootstrap', { method: 'POST', body: new URLSearchParams(fields), headers: { accept: 'text/html' } });
}

const ADMIN_FORM = { token: BASE_SETTINGS.bootstrapToken, username: 'platform-admin', displayName: '平台管理员', email: 'Admin@Corp.example', password: 'correct-horse-battery', confirmPassword: 'correct-horse-battery' };

beforeAll(async () => {
  if (!available) return;
  tdb = await createTestDatabase([identityMigrations]);
  identity = identityModuleFor(tdb.db, { settings: { ...BASE_SETTINGS, adminEmails: ['owner@corp.example'] } });
  app = mountRouters(identity, ['auth', 'users']);
});
afterAll(async () => { await tdb?.drop(); });

describe.skipIf(!available)('引导交接与常规登录', () => {
  test('全新安装：登录页只给引导入口，密码登录与 OIDC 一律 403', async () => {
    const page = await (await app.request('/auth/login')).text();
    expect(page).toContain('创建首位管理员');
    expect(page).not.toContain('name="password"');
    expect(await (await app.request('/auth/status')).json()).toMatchObject({ mode: 'bootstrap', passwordLoginEnabled: false, bootstrapTokenEnabled: true, providers: [] });
    const denied = await app.request('/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ username: 'x', password: 'y' }) });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ details: { code: 'bootstrap-admin-required' } });
    // 库里预置了 Provider 也不能提前用：引导阶段只有一条路。
    expect((await app.request('/auth/oidc/corp/start')).status).toBe(403);
  });

  test('引导令牌不对不放行；两次密码不一致与弱口令都被挡在创建之前', async () => {
    expect((await bootstrap({ ...ADMIN_FORM, token: 'wrong-token' })).status).toBe(403);
    expect((await bootstrap({ ...ADMIN_FORM, confirmPassword: 'another-horse-battery' })).status).toBe(400);
    expect((await bootstrap({ ...ADMIN_FORM, password: 'short', confirmPassword: 'short' })).status).toBe(400);
    expect(await identity.api.findByEmail('admin@corp.example')).toBeUndefined();
  });

  test('引导成功：管理员建档、完成态落库、强制开启密码登录，且不返回会话', async () => {
    const res = await bootstrap(ADMIN_FORM);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/auth/login?setup=complete');
    expect(res.headers.get('set-cookie')).toBeNull();
    const admin = await identity.api.findByEmail('admin@corp.example');
    expect(admin).toMatchObject({ name: '平台管理员', isAdmin: true });
    const policy = await drizzleLoginPolicyRepository(tdb.db).read();
    expect(policy.bootstrapCompletedAt).not.toBeNull();
    expect(policy.passwordLoginEnabled).toBe(true);
  });

  test('交接后的登录页说清下一步：引导令牌已失效，用新账户登录一次', async () => {
    const page = await (await app.request('/auth/login?setup=complete')).text();
    expect(page).toContain('首位管理员已创建');
    expect(page).toContain('name="password"');
  });

  test('引导令牌当场退役：完成后再提交一次是 409，引导页跳回登录页', async () => {
    const again = await bootstrap({ ...ADMIN_FORM, username: 'second-admin', email: 'second@corp.example' });
    expect(again.status).toBe(409);
    const page = await app.request('/auth/bootstrap');
    expect(page.status).toBe(302);
    expect(page.headers.get('location')).toBe('/auth/login');
  });

  test('常规登录：下发 cs_session Cookie 并跳回校验过的 returnTo；会话记录认证方式为密码', async () => {
    const res = await app.request('/auth/login', {
      method: 'POST',
      body: new URLSearchParams({ username: 'platform-admin', password: ADMIN_FORM.password, returnTo: 'http://demo.cs.localhost/app' }),
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('http://demo.cs.localhost/app');
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/^cs_session=[A-Za-z0-9._-]+;/);
    expect(cookie).toContain('Domain=.cs.localhost');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).not.toContain('Secure');
    const verified = await verifyWithJwks(cookieValue(res), await identity.api.jwks(), { audience: 'session', issuer: TOKEN_CLAIMS.issuer });
    expect(verified.claims).toMatchObject({ cs_kind: 'session', cs_auth: 'password' });
  });

  test('口令错、账号不存在、账号没有本地口令：都是同一句 401，不泄露账号是否存在', async () => {
    await seedLocalUser(tdb.db, { username: 'dev-one' });
    const oidcOnly = await identity.api.ensureUser({ externalId: 'oidc:idp:sub-1', name: 'OIDC 用户', email: 'oidc@corp.example' });
    expect(oidcOnly.name).toBe('OIDC 用户');
    const attempts = await Promise.all([
      app.request('/auth/login', { method: 'POST', headers: { accept: 'application/json' }, body: new URLSearchParams({ username: 'dev-one', password: 'wrong-password' }) }),
      app.request('/auth/login', { method: 'POST', headers: { accept: 'application/json' }, body: new URLSearchParams({ username: 'nobody-here', password: TEST_PASSWORD }) }),
      app.request('/auth/login', { method: 'POST', headers: { accept: 'application/json' }, body: new URLSearchParams({ username: 'oidc-user', password: TEST_PASSWORD }) }),
    ]);
    for (const attempt of attempts) {
      expect(attempt.status).toBe(401);
      expect((await attempt.json() as { message: string }).message).toBe('用户名或密码不正确');
    }
  });

  test('表单提交失败时原因显示在登录页上，JSON 调用方拿到结构化错误', async () => {
    const html = await app.request('/auth/login', { method: 'POST', headers: { accept: 'text/html' }, body: new URLSearchParams({ username: 'dev-one', password: 'wrong-password' }) });
    expect(html.status).toBe(401);
    expect(await html.text()).toContain('用户名或密码不正确');
  });

  test('/v1/me 带出本次会话的认证方式；JWKS 只含公钥', async () => {
    const { userId } = await loginWithPassword(app, identity, 'dev-one');
    const me = await app.request('/v1/me', { headers: { 'x-cs-user-id': userId } });
    expect(await me.json()).toMatchObject({ authMethod: 'password', isAdmin: false });
    const oidcSession = await app.request('/v1/me', { headers: { 'x-cs-user-id': userId, 'x-cs-auth-method': 'oidc' } });
    expect(await oidcSession.json()).toMatchObject({ authMethod: 'oidc' });
    const jwks = await (await app.request('/.well-known/jwks.json')).json() as { keys: Array<Record<string, unknown>> };
    expect(jwks.keys[0]).toMatchObject({ kty: 'EC', crv: 'P-256', alg: 'ES256', use: 'sig' });
    expect(jwks.keys[0]).not.toHaveProperty('d');
  });

  test('登出清 Cookie 并回登录页保留 returnTo；returnTo 出了用户域一律回工作台', async () => {
    const res = await app.request('/auth/logout?returnTo=http%3A%2F%2Fdemo.cs.localhost%2Fx', { method: 'POST' });
    expect(res.headers.get('location')).toBe('http://console.cs.localhost/auth/login?returnTo=http%3A%2F%2Fdemo.cs.localhost%2Fx');
    expect(res.headers.get('set-cookie')).toMatch(/^cs_session=;.*Max-Age=0/);
    const evil = await app.request('/auth/login', { method: 'POST', body: new URLSearchParams({ username: 'dev-one', password: TEST_PASSWORD, returnTo: 'https://evil.com/steal' }) });
    expect(evil.headers.get('location')).toBe('http://console.cs.localhost/');
  });

  test('X-Forwarded-Proto 为 https 时跳转用 https', async () => {
    const res = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'x-forwarded-proto': 'https' },
      body: new URLSearchParams({ username: 'dev-one', password: TEST_PASSWORD, returnTo: '/home' }),
    });
    expect(res.headers.get('location')).toBe('https://console.cs.localhost/home');
  });
});
