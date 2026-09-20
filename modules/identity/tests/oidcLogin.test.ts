import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import type { OidcProviderDto } from '@crewstation/contracts';
import { TOKEN_CLAIMS } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { verifyWithJwks } from '@crewstation/jwt';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { Hono } from 'hono';
import { drizzleOidcFlowRepository } from '../adapters/persistence/drizzleOidcRepositories';
import type { AuthAdminActor } from '../api/moduleApi';
import type { IdentityModule } from '../wiring';
import { identityMigrations } from '../wiring';
import type { FakeIdpState } from './fakeIdp';
import { challengeMatches, directResolver, fakeIdp } from './fakeIdp';
import { BASE_SETTINGS, completeBootstrap, identityModuleFor, mountRouters } from './identityFixture';

const available = await testDatabaseAvailable();
const ISSUER = 'https://idp.corp.example';
const admin: AuthAdminActor = { userId: '01a0bf5d-8f4b-7a14-83c9-8e56fbdde549' as AuthAdminActor['userId'], isAdmin: true, authMethod: 'password' };

const STANDARD_DISCOVERY = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/authorize`,
  token_endpoint: `${ISSUER}/token`,
  userinfo_endpoint: `${ISSUER}/userinfo`,
  jwks_uri: `${ISSUER}/jwks`,
  scopes_supported: ['openid', 'profile', 'email'],
};

let tdb: TestDatabase;
let identity: IdentityModule;
let app: Hono<AppEnv>;
let state: FakeIdpState;

function freshState(): FakeIdpState {
  return {
    discovery: { ...STANDARD_DISCOVERY },
    idToken: 'id-token',
    verified: { sub: 'corp-sub-1', email: 'zhang@corp.example', email_verified: true, name: '张三', preferred_username: 'zhangsan' },
    userinfo: { sub: 'corp-sub-1', email: 'zhang@corp.example', email_verified: true, name: '张三', preferred_username: 'zhangsan' },
    jwksReachable: true,
  };
}

async function createProvider(overrides: Record<string, unknown> = {}): Promise<OidcProviderDto> {
  return identity.api.createProvider(admin, {
    slug: `corp-${Math.random().toString(36).slice(2, 8)}`,
    displayName: '公司统一身份',
    issuerUrl: ISSUER,
    clientId: 'cs-platform',
    clientSecret: 'super-secret',
    scopes: 'openid profile email',
    provisioning: 'auto',
    ...overrides,
  });
}

/** 走完整条 start → callback，返回回调响应。 */
async function login(provider: OidcProviderDto, returnTo?: string): Promise<{ callback: Response; authorizeUrl: URL }> {
  const start = await app.request(`/auth/oidc/${provider.slug}/start${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`);
  const authorizeUrl = new URL(start.headers.get('location') ?? '');
  const callback = await app.request(`/auth/oidc/${provider.slug}/callback?code=auth-code&state=${encodeURIComponent(authorizeUrl.searchParams.get('state') ?? '')}`);
  return { callback, authorizeUrl };
}

function cookieOf(response: Response): string {
  return /cs_session=([^;]*)/.exec(response.headers.get('set-cookie') ?? '')?.[1] ?? '';
}

async function failureOf(response: Response): Promise<string> {
  return /<code>([a-z-]+)<\/code>/.exec(await response.text())?.[1] ?? 'no-code';
}

beforeAll(async () => {
  if (!available) return;
  tdb = await createTestDatabase([identityMigrations]);
  state = freshState();
  const idp = fakeIdp(state);
  identity = identityModuleFor(tdb.db, { settings: { ...BASE_SETTINGS, adminEmails: ['boss@corp.example'] }, idp, endpointResolver: directResolver(idp) });
  app = mountRouters(identity, ['auth']);
  await completeBootstrap(tdb.db);
});
afterAll(async () => { await tdb?.drop(); });
beforeEach(() => { if (available) Object.assign(state, freshState()); });

describe.skipIf(!available)('OIDC 登录链', () => {
  test('发起登录：跳转带齐 PKCE 与 nonce，redirect_uri 由安装配置推出而不读请求 Host', async () => {
    const provider = await createProvider();
    const start = await app.request(`/auth/oidc/${provider.slug}/start`, { headers: { host: 'evil.example.com', 'x-forwarded-host': 'evil.example.com' } });
    expect(start.status).toBe(302);
    const url = new URL(start.headers.get('location') ?? '');
    expect(url.origin + url.pathname).toBe(`${ISSUER}/authorize`);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('cs-platform');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toBe('openid profile email');
    expect(url.searchParams.get('redirect_uri')).toBe(`http://console.cs.localhost/auth/oidc/${provider.slug}/callback`);
    expect(url.searchParams.get('nonce')).toBeTruthy();
  });

  test('标准 OIDC 回调：验签取身份、建档、下发会话，会话记录认证方式为 oidc', async () => {
    const provider = await createProvider();
    const { callback, authorizeUrl } = await login(provider, 'http://demo.cs.localhost/app');
    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toBe('http://demo.cs.localhost/app');
    // 换码必须带回发起时那把 verifier 与同一个 redirect_uri，且密钥是解封后的明文。
    expect(challengeMatches(state.lastExchange?.codeVerifier ?? '', authorizeUrl.searchParams.get('code_challenge') ?? '')).toBe(true);
    expect(state.lastExchange?.redirectUri).toBe(`http://console.cs.localhost/auth/oidc/${provider.slug}/callback`);
    expect(state.lastExchange?.clientSecret).toBe('super-secret');
    const session = cookieOf(callback);
    const verified = await verifyWithJwks(session, await identity.api.jwks(), { audience: 'session', issuer: TOKEN_CLAIMS.issuer });
    expect(verified.claims).toMatchObject({ cs_auth: 'oidc' });
    const user = await identity.api.resolveSession(session);
    // 没配显示名选择器时按 preferred_username → name → email 回落，所以这里是 zhangsan 而不是 name。
    expect(user).toMatchObject({ name: 'zhangsan', email: 'zhang@corp.example', isAdmin: false });
  });

  test('同一主体再次登录：认出原账户并刷新档案，不新建用户', async () => {
    const provider = await createProvider();
    const first = await login(provider);
    const firstUser = await identity.api.resolveSession(cookieOf(first.callback));
    state.verified = { ...(state.verified as Record<string, unknown>), preferred_username: 'zhangsan-renamed' };
    state.userinfo = { ...(state.userinfo as Record<string, unknown>), preferred_username: 'zhangsan-renamed' };
    const second = await login(provider);
    const secondUser = await identity.api.resolveSession(cookieOf(second.callback));
    expect(secondUser?.id).toBe(firstUser?.id);
    // 每次成功登录都按选择器重解析档案并回写，这就是「改了名下次登录就生效」。
    expect(secondUser?.name).toBe('zhangsan-renamed');
  });

  test('不同 Provider 的同名主体互不合并：两个账户（作者裁定 A12）', async () => {
    const first = await createProvider();
    const second = await createProvider();
    const a = await identity.api.resolveSession(cookieOf((await login(first)).callback));
    const b = await identity.api.resolveSession(cookieOf((await login(second)).callback));
    expect(a?.id).not.toBe(b?.id);
  });

  test('纯 OAuth 2.0：没有 discovery、没有 id_token，身份取自手工 userinfo 端点', async () => {
    state.discovery = null;
    state.idToken = null;
    const provider = await createProvider({
      authorizationEndpoint: `${ISSUER}/oauth/authorize`,
      tokenEndpoint: `${ISSUER}/oauth/token`,
      userinfoEndpoint: `${ISSUER}/api/user`,
      subjectClaim: 'id',
      usernameClaim: 'firstName lastName',
      emailClaim: 'mail',
      trustEmailVerified: true,
      provisioning: 'allowlist',
      allowedEmailDomains: ['@corp.example'],
    });
    state.userinfo = { id: 90021, firstName: '张', lastName: '三', mail: 'Zhang@Corp.Example' };
    const { callback } = await login(provider);
    expect(callback.status).toBe(302);
    const user = await identity.api.resolveSession(cookieOf(callback));
    expect(user).toMatchObject({ name: '张 三', email: 'zhang@corp.example' });
  });

  test('非标 userinfo：post_json 风格与配置的 scope 原样发出', async () => {
    const provider = await createProvider({ userinfoRequestStyle: 'post_json', subjectClaim: 'id', scopes: 'base_info user_info' });
    state.userinfo = { id: 'emp-7', name: '李四' };
    await login(provider);
    expect(state.lastUserinfo).toMatchObject({ style: 'post_json', clientId: 'cs-platform', scopes: 'base_info user_info' });
  });

  test('state 一次性：同一个 state 回放第二次被拒，过期的也被拒', async () => {
    const provider = await createProvider();
    const start = await app.request(`/auth/oidc/${provider.slug}/start`);
    const stateValue = new URL(start.headers.get('location') ?? '').searchParams.get('state') ?? '';
    const first = await app.request(`/auth/oidc/${provider.slug}/callback?code=c1&state=${encodeURIComponent(stateValue)}`);
    expect(first.status).toBe(302);
    const replay = await app.request(`/auth/oidc/${provider.slug}/callback?code=c1&state=${encodeURIComponent(stateValue)}`);
    expect(replay.status).toBe(400);
    expect(await failureOf(replay)).toBe('state-expired');
    // 过期行同样取不出来：consume 的条件里带着 expires_at。
    const flows = drizzleOidcFlowRepository(tdb.db);
    const expired = await app.request(`/auth/oidc/${provider.slug}/start`);
    const expiredState = new URL(expired.headers.get('location') ?? '').searchParams.get('state') ?? '';
    expect(await flows.consume(expiredState, new Date(Date.now() + 10 * 60 * 1000))).toBeUndefined();
  });

  test('缺参数、Provider 停用、换码失败、验签失败、userinfo 主体不符：各自一个确定的原因页', async () => {
    const provider = await createProvider();
    expect(await failureOf(await app.request(`/auth/oidc/${provider.slug}/callback`))).toBe('invalid-callback');

    state.tokenEndpointFails = true;
    expect(await failureOf((await login(provider)).callback)).toBe('token-exchange-failed');
    state.tokenEndpointFails = false;

    state.verified = 'fail';
    expect(await failureOf((await login(provider)).callback)).toBe('id-token-verify-failed');
    state.verified = { sub: 'corp-sub-1' };

    // 配了档案字段时 userinfo 必须绑定在已验证主体上。
    const bound = await createProvider({ usernameClaim: 'name' });
    state.userinfo = { sub: 'someone-else', name: '冒名者' };
    expect(await failureOf((await login(bound)).callback)).toBe('userinfo-subject-mismatch');

    const disabled = await createProvider();
    const start = await app.request(`/auth/oidc/${disabled.slug}/start`);
    const stateValue = new URL(start.headers.get('location') ?? '').searchParams.get('state') ?? '';
    await identity.api.patchProvider(admin, disabled.id, { enabled: false });
    expect(await failureOf(await app.request(`/auth/oidc/${disabled.slug}/callback?code=c&state=${encodeURIComponent(stateValue)}`))).toBe('provider-disabled');
    expect((await app.request(`/auth/oidc/${disabled.slug}/start`)).status).toBe(404);
  });

  test('开通策略的两条拒绝：邮箱未验证与域名不符', async () => {
    const provider = await createProvider({ provisioning: 'allowlist', allowedEmailDomains: ['@corp.example'] });
    state.verified = { sub: 'new-1', email: 'x@corp.example', email_verified: false };
    expect(await failureOf((await login(provider)).callback)).toBe('email-not-verified');
    state.verified = { sub: 'new-2', email: 'x@other.example', email_verified: true };
    expect(await failureOf((await login(provider)).callback)).toBe('email-domain-not-allowed');
  });

  test('邮箱命中安装配置的管理员名单即为管理员；否则默认不是', async () => {
    const provider = await createProvider();
    state.verified = { sub: 'boss-1', email: 'boss@corp.example', email_verified: true, name: '老板' };
    const user = await identity.api.resolveSession(cookieOf((await login(provider)).callback));
    expect(user).toMatchObject({ email: 'boss@corp.example', isAdmin: true });
  });

  test('自动发现失败且没有手工端点：起不了跳转，回 503 且错误码可辨', async () => {
    state.discovery = null;
    const provider = await createProvider();
    const start = await app.request(`/auth/oidc/${provider.slug}/start`, { headers: { accept: 'application/json' } });
    expect(start.status).toBe(503);
    expect(await start.json()).toMatchObject({ details: { code: 'endpoints-unresolved' } });
  });
});
