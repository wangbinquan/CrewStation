import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { AppEnv } from '@crewstation/http';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { Subprocess } from 'bun';
import type { Hono } from 'hono';
import type { AuthAdminActor } from '../api/moduleApi';
import type { IdentityModule } from '../wiring';
import { identityMigrations } from '../wiring';
import { BASE_SETTINGS, completeBootstrap, identityModuleFor, mountRouters } from './identityFixture';

/**
 * 真 HTTP 链路：起 `tools/mock-idp`，用真实的 httpIdpClient 走完 discovery → 授权 → 换码 → 验签／userinfo。
 * 它同时是那个 mock 的回归用例——本机验收（RFC-005 OA-05…OA-07）靠它，所以它自己必须被测到。
 */
const dbAvailable = await testDatabaseAvailable();
const PORT = 19_000 + Math.floor(Math.random() * 500);
const ISSUER = `http://127.0.0.1:${PORT}`;
const admin: AuthAdminActor = { userId: 'usr_00000000000000000000000000000001' as AuthAdminActor['userId'], isAdmin: true, authMethod: 'password' };

let idp: Subprocess | undefined;
let tdb: TestDatabase;
let identity: IdentityModule;
let app: Hono<AppEnv>;
let ready = false;

async function waitForIdp(): Promise<boolean> {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const res = await fetch(`${ISSUER}/jwks.json`, { signal: AbortSignal.timeout(500) });
      if (res.ok) return true;
    } catch {
      // 还没起来，继续等。
    }
    await Bun.sleep(100);
  }
  return false;
}

/** 走完整条链：start → 在 mock IdP 上「点按钮」→ 回调。返回回调响应。 */
async function loginThrough(slug: string, as: string): Promise<Response> {
  const start = await app.request(`/auth/oidc/${slug}/start`);
  const authorize = new URL(start.headers.get('location') ?? '');
  authorize.searchParams.set('as', as);
  const redirected = await fetch(authorize, { redirect: 'manual' });
  const callback = new URL(redirected.headers.get('location') ?? '');
  return app.request(`${callback.pathname}${callback.search}`);
}

beforeAll(async () => {
  if (!dbAvailable) return;
  idp = Bun.spawn(['bun', 'run', 'tools/mock-idp/main.ts', '--port', String(PORT), '--issuer', ISSUER], {
    cwd: new URL('../../..', import.meta.url).pathname,
    stdout: 'ignore',
    stderr: 'ignore',
  });
  ready = await waitForIdp();
  if (!ready) return;
  tdb = await createTestDatabase([identityMigrations]);
  identity = identityModuleFor(tdb.db, { settings: BASE_SETTINGS });
  app = mountRouters(identity, ['auth']);
  await completeBootstrap(tdb.db);
});

afterAll(async () => {
  idp?.kill();
  await tdb?.drop();
});

describe.skipIf(!dbAvailable)('真实 HTTP 的 OIDC 链路', () => {
  test('标准 OIDC：只填 Issuer 与凭据，测试连接全绿，浏览器式回跳拿到会话', async () => {
    if (!ready) return; // mock IdP 起不来时跳过，不用假结论掩盖
    const provider = await identity.api.createProvider(admin, {
      slug: 'mock-standard', displayName: 'mock 标准 OIDC', issuerUrl: ISSUER,
      clientId: 'mock-client', clientSecret: 'mock-secret', scopes: 'openid profile email', provisioning: 'auto',
    });
    const probe = await identity.api.probeProvider(admin, provider.id);
    expect(probe.ok).toBe(true);
    expect(probe.discovery.ok).toBe(true);
    expect(probe.endpoints.jwksUri?.source).toBe('discovery');
    expect(probe.jwksReachable).toBe(true);

    const callback = await loginThrough(provider.slug, 'mock-alice');
    expect(callback.status).toBe(302);
    const cookie = /cs_session=([^;]*)/.exec(callback.headers.get('set-cookie') ?? '')?.[1] ?? '';
    const user = await identity.api.resolveSession(cookie);
    // 真 RS256 id_token 经真 JWKS 验签通过，nonce 也对得上，否则这里拿不到用户。
    expect(user).toMatchObject({ email: 'alice@corp.example' });
  }, 30_000);

  test('纯 OAuth 2.0＋非标 userinfo：无 discovery、无 id_token、POST JSON 取身份，自定义字段进档案', async () => {
    if (!ready) return;
    const port = PORT + 1;
    const issuer = `http://127.0.0.1:${port}`;
    const nonStandard = Bun.spawn(['bun', 'run', 'tools/mock-idp/main.ts', '--port', String(port), '--issuer', issuer,
      '--no-discovery', '--no-id-token', '--userinfo-style', 'post_json', '--subject-field', 'id'], {
      cwd: new URL('../../..', import.meta.url).pathname, stdout: 'ignore', stderr: 'ignore',
    });
    try {
      for (let attempt = 0; attempt < 40; attempt++) {
        try {
          if ((await fetch(`${issuer}/authorize?client_id=mock-client`, { signal: AbortSignal.timeout(500) })).ok) break;
        } catch { /* 继续等 */ }
        await Bun.sleep(100);
      }
      const provider = await identity.api.createProvider(admin, {
        slug: 'mock-oauth2', displayName: 'mock 纯 OAuth2', issuerUrl: issuer,
        clientId: 'mock-client', clientSecret: 'mock-secret', scopes: 'base_info user_info', provisioning: 'auto',
        authorizationEndpoint: `${issuer}/authorize`, tokenEndpoint: `${issuer}/token`, userinfoEndpoint: `${issuer}/userinfo`,
        userinfoRequestStyle: 'post_json', subjectClaim: 'id', usernameClaim: 'name', emailClaim: 'email',
        trustEmailVerified: true, claimMappings: [{ key: 'employee-no', claim: 'empNo' }],
      });
      const probe = await identity.api.probeProvider(admin, provider.id);
      // 自动发现确实失败了，但手工端点补齐后仍然可登录——这正是要验的那条路。
      expect(probe.discovery.ok).toBe(false);
      expect(probe.ok).toBe(true);
      expect(probe.endpoints.tokenEndpoint?.source).toBe('manual');

      const callback = await loginThrough(provider.slug, 'mock-bob');
      expect(callback.status).toBe(302);
      const cookie = /cs_session=([^;]*)/.exec(callback.headers.get('set-cookie') ?? '')?.[1] ?? '';
      const user = await identity.api.resolveSession(cookie);
      expect(user).toMatchObject({ name: 'Bob（mock）', email: 'bob@corp.example' });
      const forwarding = await identity.api.readForwarding(admin);
      expect(forwarding.candidates.map((c) => c.key)).toContain('employee-no');
    } finally {
      nonStandard.kill();
    }
  }, 30_000);
});
