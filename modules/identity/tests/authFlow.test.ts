import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { IDENTITY_HEADERS, TOKEN_CLAIMS } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { createApp } from '@crewstation/http';
import { verifyWithJwks } from '@crewstation/jwt';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { Hono } from 'hono';
import { demoIdentityProvider } from '../adapters/provider/demoIdentityProvider';
import type { IdentityModule } from '../wiring';
import { createIdentityModule, identityMigrations } from '../wiring';

const available = await testDatabaseAvailable();
const settings = { adminEmails: ['boss@demo.invalid'], userDomain: 'cs.localhost', cookieDomain: '.cs.localhost', secure: false, sessionTtlSeconds: 3600 };
let tdb: TestDatabase;
let identity: IdentityModule;
let app: Hono<AppEnv>;

function mount(module: IdentityModule): Hono<AppEnv> {
  const hono = createApp({ name: 'test' });
  for (const router of [...module.http.auth, ...module.http.forwardAuth, ...module.http.users]) hono.route('/', router);
  return hono;
}

async function loginForm(fields: Record<string, string>): Promise<Response> {
  return app.request('/auth/login', { method: 'POST', body: new URLSearchParams(fields), headers: { accept: 'text/html' } });
}

function cookieValue(res: Response): string {
  const header = res.headers.get('set-cookie') ?? '';
  return /cs_session=([^;]*)/.exec(header)?.[1] ?? '';
}

beforeAll(async () => {
  if (!available) return;
  tdb = await createTestDatabase([identityMigrations]);
  identity = createIdentityModule({ db: tdb.db, settings, provider: demoIdentityProvider() });
  app = mount(identity);
});
afterAll(async () => { await tdb?.drop(); });

describe.skipIf(!available)('auth flow (demo provider)', () => {
  test('GET /auth/login 渲染带“演示身份”提示的表单，returnTo 已校验并回填', async () => {
    const res = await app.request('/auth/login?returnTo=http%3A%2F%2Fdemo.cs.localhost%2Fapp%3Fx%3D1');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('演示身份');
    expect(html).toContain('name="returnTo" value="http://demo.cs.localhost/app?x=1"');
    const evil = await (await app.request('/auth/login?returnTo=http%3A%2F%2Fevil.com%2F')).text();
    expect(evil).toContain('name="returnTo" value="http://console.cs.localhost/"');
  });

  test('POST /auth/login：建档、下发 cs_session Cookie 并 302 到校验过的 returnTo', async () => {
    const res = await loginForm({ username: 'alice', displayName: 'Alice', email: 'alice@example.com', returnTo: 'http://demo.cs.localhost/app' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('http://demo.cs.localhost/app');
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/^cs_session=[A-Za-z0-9._-]+;/);
    expect(cookie).toContain('Max-Age=3600');
    expect(cookie).toContain('Domain=.cs.localhost');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).not.toContain('Secure');
    const user = await identity.api.resolveSession(cookieValue(res));
    expect(user).toMatchObject({ name: 'Alice', email: 'alice@example.com', isAdmin: true });
    expect((await identity.api.currentUser(user!.id)).demoIdentity).toBe(true);
  });

  test('returnTo 不在用户域内 → 回工作台；缺省邮箱落在 demo.invalid；JSON 提交得到 JSON', async () => {
    const res = await loginForm({ username: 'bob', returnTo: 'https://evil.com/steal' });
    expect(res.headers.get('location')).toBe('http://console.cs.localhost/');
    const json = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ username: 'carol', returnTo: '/projects' }),
    });
    expect(json.status).toBe(200);
    expect(await json.json()).toMatchObject({ user: { name: 'carol', email: 'carol@demo.invalid', isAdmin: false }, returnTo: 'http://console.cs.localhost/projects' });
  });

  test('非法用户名 400；空的可选字段按缺省处理', async () => {
    expect((await loginForm({ username: 'Bad Name' })).status).toBe(400);
    const res = await loginForm({ username: 'dave', displayName: '', email: '', returnTo: '' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('http://console.cs.localhost/');
  });

  test('/auth/status 与 JWKS：演示提供者、路径、只含公钥', async () => {
    expect(await (await app.request('/auth/status')).json()).toEqual({ provider: 'demo', loginPath: '/auth/login', logoutPath: '/auth/logout', jwksPath: '/.well-known/jwks.json' });
    const jwks = await (await app.request('/.well-known/jwks.json')).json() as { keys: Array<Record<string, unknown>> };
    expect(jwks.keys.length).toBe(1);
    expect(jwks.keys[0]).toMatchObject({ kty: 'EC', crv: 'P-256', alg: 'ES256', use: 'sig' });
    expect(jwks.keys[0]).not.toHaveProperty('d');
  });

  test('会话令牌本身可用 JWKS 验签：sub=user:<id>、aud=session、iss=crewstation', async () => {
    const res = await loginForm({ username: 'erin' });
    const jwks = await identity.api.jwks();
    const verified = await verifyWithJwks(cookieValue(res), jwks, { audience: 'session', issuer: TOKEN_CLAIMS.issuer });
    expect(verified.subject).toMatch(/^user:usr_[0-9a-f]{32}$/);
    expect(verified.claims).toMatchObject({ cs_kind: 'session' });
  });

  test('登出清 Cookie 并回登录页保留 returnTo', async () => {
    const res = await app.request('/auth/logout?returnTo=http%3A%2F%2Fdemo.cs.localhost%2Fx', { method: 'POST' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('http://console.cs.localhost/auth/login?returnTo=http%3A%2F%2Fdemo.cs.localhost%2Fx');
    expect(res.headers.get('set-cookie')).toMatch(/^cs_session=;.*Max-Age=0/);
  });

  test('X-Forwarded-Proto 为 https 时跳转与登录页都用 https', async () => {
    const res = await loginForm({ username: 'frank', returnTo: '/home' });
    expect(res.headers.get('location')).toBe('http://console.cs.localhost/home');
    const https = await app.request('/auth/login', { method: 'POST', body: new URLSearchParams({ username: 'frank', returnTo: '/home' }), headers: { 'x-forwarded-proto': 'https' } });
    expect(https.headers.get('location')).toBe('https://console.cs.localhost/home');
  });

  test('未配置身份提供者：/auth/* 回 503，JWKS 仍可用，管理面不受影响', async () => {
    const bare = mount(createIdentityModule({ db: tdb.db, settings }));
    const login = await bare.request('/auth/login');
    expect(login.status).toBe(503);
    expect(await login.json()).toMatchObject({ error: 'unavailable', message: '未配置身份提供者' });
    expect((await bare.request('/auth/status')).status).toBe(503);
    expect((await bare.request('/.well-known/jwks.json')).status).toBe(200);
    const me = await bare.request('/v1/me', { headers: { [IDENTITY_HEADERS.userId]: (await identity.api.findByEmail('alice@example.com'))!.id } });
    expect(me.status).toBe(200);
  });
});
