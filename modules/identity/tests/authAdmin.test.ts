import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { OidcProviderDto, ProjectId, UserId } from '@crewstation/contracts';
import { IDENTITY_HEADERS, TOKEN_CLAIMS } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { verifyWithJwks } from '@crewstation/jwt';
import { isPlatformError } from '@crewstation/kernel';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { Hono } from 'hono';
import type { AuthAdminActor } from '../api/moduleApi';
import type { IdentityModule } from '../wiring';
import { identityMigrations } from '../wiring';
import type { FakeIdpState } from './fakeIdp';
import { directResolver, fakeIdp } from './fakeIdp';
import { BASE_SETTINGS, completeBootstrap, identityModuleFor, loginWithPassword, mountRouters, seedLocalUser } from './identityFixture';

const available = await testDatabaseAvailable();
const ISSUER = 'https://idp.corp.example';
const projectId = 'prj_0123456789abcdef0123456789abcdef' as ProjectId;
let tdb: TestDatabase;
let identity: IdentityModule;
let app: Hono<AppEnv>;
let state: FakeIdpState;
let adminId: UserId;
let passwordAdmin: AuthAdminActor;
let oidcAdmin: AuthAdminActor;

async function createProvider(overrides: Record<string, unknown> = {}): Promise<OidcProviderDto> {
  return identity.api.createProvider(passwordAdmin, {
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

async function codeOf(action: () => Promise<unknown>): Promise<string> {
  try {
    await action();
    return 'no-throw';
  } catch (error) {
    return isPlatformError(error) ? String(error.details.code ?? error.kind) : 'other';
  }
}

async function forwardUser(host: string, cookie: string): Promise<Response> {
  return app.request('/forward-auth/user', { headers: { 'x-forwarded-proto': 'http', 'x-forwarded-host': host, 'x-forwarded-uri': '/', 'x-forwarded-method': 'GET', cookie: `cs_session=${cookie}` } });
}

beforeAll(async () => {
  if (!available) return;
  tdb = await createTestDatabase([identityMigrations]);
  state = {
    discovery: { issuer: ISSUER, authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token`, userinfo_endpoint: `${ISSUER}/userinfo`, jwks_uri: `${ISSUER}/jwks`, scopes_supported: ['openid'] },
    idToken: 'id-token',
    verified: { sub: 'corp-sub-1', email: 'zhang@corp.example', email_verified: true, preferred_username: 'zhangsan' },
    userinfo: { sub: 'corp-sub-1', email: 'zhang@corp.example', email_verified: true, preferred_username: 'zhangsan', empNo: 'E-9', deptName: '平台组' },
    jwksReachable: true,
  };
  const idp = fakeIdp(state);
  identity = identityModuleFor(tdb.db, {
    settings: BASE_SETTINGS,
    idp,
    endpointResolver: directResolver(idp),
    projectDirectory: { idBySlug: async (slug) => (slug === 'demo' ? projectId : undefined) },
  });
  app = mountRouters(identity, ['auth', 'forwardAuth', 'users']);
  await completeBootstrap(tdb.db);
  adminId = await seedLocalUser(tdb.db, { username: 'admin-one', name: '管理员', email: 'admin@corp.example', isAdmin: true, gitName: 'admin-git' });
  passwordAdmin = { userId: adminId, isAdmin: true, authMethod: 'password' };
  oidcAdmin = { userId: adminId, isAdmin: true, authMethod: 'oidc' };
});
afterAll(async () => { await tdb?.drop(); });

describe.skipIf(!available)('身份提供方管理', () => {
  test('新建后列表可见，client_secret 只回「已设置」而不回值；非管理员一律 403', async () => {
    const provider = await createProvider({ slug: 'corp-main' });
    expect(provider.clientSecretSet).toBe(true);
    expect(JSON.stringify(provider)).not.toContain('super-secret');
    const listed = await identity.api.listProviders(passwordAdmin);
    expect(listed.map((p) => p.slug)).toContain('corp-main');
    expect(JSON.stringify(listed)).not.toContain('super-secret');
    expect(await codeOf(() => identity.api.listProviders({ ...passwordAdmin, isAdmin: false }))).toBe('forbidden');
    expect(await codeOf(() => createProvider({ slug: 'corp-main' }))).toBe('oidc-slug-taken');
  });

  test('改配置：留空的 client_secret 保持原值，换值则真的换掉', async () => {
    const provider = await createProvider();
    await identity.api.patchProvider(passwordAdmin, provider.id, { displayName: '改了名字' });
    expect((await identity.api.getProvider(passwordAdmin, provider.id)).displayName).toBe('改了名字');
    // 没传 clientSecret 时不动密文：换码仍能拿到原来的明文。
    const start = await app.request(`/auth/oidc/${provider.slug}/start`);
    const stateValue = new URL(start.headers.get('location') ?? '').searchParams.get('state') ?? '';
    await app.request(`/auth/oidc/${provider.slug}/callback?code=c&state=${encodeURIComponent(stateValue)}`);
    expect(state.lastExchange?.clientSecret).toBe('super-secret');
    await identity.api.patchProvider(passwordAdmin, provider.id, { clientSecret: 'rotated-secret' });
    const second = await app.request(`/auth/oidc/${provider.slug}/start`);
    const secondState = new URL(second.headers.get('location') ?? '').searchParams.get('state') ?? '';
    await app.request(`/auth/oidc/${provider.slug}/callback?code=c2&state=${encodeURIComponent(secondState)}`);
    expect(state.lastExchange?.clientSecret).toBe('rotated-secret');
  });

  test('主体字段一旦有关联身份就不许再改；没有关联身份时可以改', async () => {
    const provider = await createProvider({ subjectClaim: null });
    await identity.api.patchProvider(passwordAdmin, provider.id, { subjectClaim: 'id' });
    expect((await identity.api.getProvider(passwordAdmin, provider.id)).subjectClaim).toBe('id');
    state.userinfo = { id: 'emp-1', preferred_username: 'emp-one' };
    const start = await app.request(`/auth/oidc/${provider.slug}/start`);
    const stateValue = new URL(start.headers.get('location') ?? '').searchParams.get('state') ?? '';
    expect((await app.request(`/auth/oidc/${provider.slug}/callback?code=c&state=${encodeURIComponent(stateValue)}`)).status).toBe(302);
    expect(await codeOf(() => identity.api.patchProvider(passwordAdmin, provider.id, { subjectClaim: 'employeeId' }))).toBe('subject-claim-locked-by-identities');
    // 等值重写不算改动，不该被拒。
    await identity.api.patchProvider(passwordAdmin, provider.id, { subjectClaim: 'id' });
    expect(await codeOf(() => identity.api.removeProvider(passwordAdmin, provider.id))).toBe('provider-still-linked');
  });

  test('测试连接：逐端点标出来源与 JWKS 可达性，配置坏掉时 ok 为假但仍返回诊断', async () => {
    const provider = await createProvider({ userinfoEndpoint: `${ISSUER}/manual-userinfo` });
    const probe = await identity.api.probeProvider(passwordAdmin, provider.id);
    expect(probe.ok).toBe(true);
    expect(probe.endpoints.authorizationEndpoint).toEqual({ url: `${ISSUER}/authorize`, source: 'discovery' });
    expect(probe.jwksReachable).toBe(true);
    expect(probe.scopesSupported).toEqual(['openid']);
    state.jwksReachable = false;
    const broken = await identity.api.probeProvider(passwordAdmin, provider.id);
    expect(broken.ok).toBe(false);
    expect(broken.jwksReachable).toBe(false);
    state.jwksReachable = true;
    state.discovery = null;
    const noDiscovery = await identity.api.probeProvider(passwordAdmin, provider.id);
    expect(noDiscovery.discovery.ok).toBe(false);
    expect(noDiscovery.discovery.error).toContain('oidc-discovery-failed');
    expect(noDiscovery.endpoints.userinfoEndpoint).toEqual({ url: `${ISSUER}/manual-userinfo`, source: 'manual' });
    state.discovery = { issuer: ISSUER, authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token`, userinfo_endpoint: `${ISSUER}/userinfo`, jwks_uri: `${ISSUER}/jwks`, scopes_supported: ['openid'] };
  });
});

describe.skipIf(!available)('登录策略', () => {
  test('关闭常规登录要三条同时成立；密码会话的管理员关不掉', async () => {
    const policy = await identity.api.readLoginPolicy(passwordAdmin);
    expect(policy).toMatchObject({ passwordLoginEnabled: true, forcedOn: false, callerAuthMethod: 'password' });
    expect(policy.enabledProviderCount).toBeGreaterThan(0);
    expect(await codeOf(() => identity.api.setPasswordLoginEnabled({ ...oidcAdmin, isAdmin: false }, false))).toBe('forbidden');
    // A2 的核心：只有已经证明能经 OIDC 进来的管理员才能关掉密码登录。
    expect(await codeOf(() => identity.api.setPasswordLoginEnabled(passwordAdmin, false))).toBe('password-login-requires-oidc-session');
    const after = await identity.api.setPasswordLoginEnabled(oidcAdmin, false);
    expect(after.passwordLoginEnabled).toBe(false);
  });

  test('关闭期间：登录页不渲染密码表单，POST 固定 403，最后一个启用 Provider 不许停用或删除', async () => {
    const page = await (await app.request('/auth/login')).text();
    expect(page).not.toContain('name="password"');
    expect(page).toContain('使用公司统一身份登录');
    const denied = await app.request('/auth/login', { method: 'POST', headers: { accept: 'application/json' }, body: new URLSearchParams({ username: 'admin-one', password: 'test-password-1234' }) });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ details: { code: 'password-login-disabled' } });
    const providers = await identity.api.listProviders(oidcAdmin);
    const enabled = providers.filter((p) => p.enabled);
    for (const extra of enabled.slice(1)) await identity.api.patchProvider(oidcAdmin, extra.id, { enabled: false });
    const last = enabled[0]!;
    expect(await codeOf(() => identity.api.patchProvider(oidcAdmin, last.id, { enabled: false }))).toBe('last-enabled-oidc-required');
    expect(await codeOf(() => identity.api.removeProvider(oidcAdmin, last.id))).toBe('last-enabled-oidc-required');
  });

  test('重新打开即刻生效，无需重启；安装配置强制开启时开关禁改', async () => {
    const reopened = await identity.api.setPasswordLoginEnabled(oidcAdmin, true);
    expect(reopened.passwordLoginEnabled).toBe(true);
    const { cookie } = await loginWithPassword(app, identity, 'admin-one');
    expect(cookie).not.toBe('');
    const forced = identityModuleFor(tdb.db, { settings: { ...BASE_SETTINGS, passwordLoginForcedOn: true } });
    const snapshot = await forced.api.readLoginPolicy(oidcAdmin);
    expect(snapshot.forcedOn).toBe(true);
    expect(await codeOf(() => forced.api.setPasswordLoginEnabled(oidcAdmin, false))).toBe('password-login-forced-on');
  });
});

describe.skipIf(!available)('身份转发', () => {
  test('默认集合与本 RFC 之前一致：显示名与邮箱照旧外发，用户 ID 与身份令牌恒定外发', async () => {
    const effective = await identity.api.effectiveForwarding(projectId);
    expect(effective).toMatchObject({ source: 'global', fields: ['email', 'name'] });
    expect(effective.headers).toEqual([IDENTITY_HEADERS.identityToken, IDENTITY_HEADERS.userEmail, IDENTITY_HEADERS.userId, IDENTITY_HEADERS.userName].sort());
    const { cookie } = await loginWithPassword(app, identity, 'admin-one');
    const res = await forwardUser('demo.cs.localhost', cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get(IDENTITY_HEADERS.userName)).toBe('管理员'.normalize() === '管理员' ? "UTF-8''%E7%AE%A1%E7%90%86%E5%91%98" : '');
    expect(res.headers.get(IDENTITY_HEADERS.userEmail)).toBe('admin@corp.example');
  });

  test('关掉邮箱：该头与令牌声明同时消失，而不是给一个空串', async () => {
    await identity.api.setGlobalForwarding(passwordAdmin, { fields: ['name'] });
    const { cookie } = await loginWithPassword(app, identity, 'admin-one');
    const res = await forwardUser('demo.cs.localhost', cookie);
    expect(res.headers.has(IDENTITY_HEADERS.userEmail)).toBe(false);
    const claims = (await verifyWithJwks(res.headers.get(IDENTITY_HEADERS.identityToken) ?? '', await identity.api.jwks(), { audience: 'service:demo/demo', issuer: TOKEN_CLAIMS.issuer })).claims;
    expect(claims).not.toHaveProperty('email');
    expect(claims).toMatchObject({ cs_project: 'demo', cs_slot: 'prod' });
  });

  test('按项目覆盖优先于全局默认；删除覆盖即回到默认', async () => {
    await identity.api.setProjectForwarding(passwordAdmin, projectId, { fields: ['name', 'email', 'git-name'] });
    const overridden = await identity.api.effectiveForwarding(projectId);
    expect(overridden).toMatchObject({ source: 'project', fields: ['email', 'git-name', 'name'] });
    await identity.api.clearProjectForwarding(passwordAdmin, projectId);
    expect((await identity.api.effectiveForwarding(projectId)).source).toBe('global');
  });

  test('自定义映射字段：登录后进档案，允许转发才注入头与 cs_attrs 声明', async () => {
    const provider = await createProvider({ claimMappings: [{ key: 'employee-no', claim: 'empNo' }, { key: 'department', claim: 'deptName' }], usernameClaim: 'preferred_username' });
    state.userinfo = { sub: 'corp-sub-attr', preferred_username: 'attr-user', email: 'attr@corp.example', email_verified: true, empNo: 'E-9', deptName: '平台组' };
    state.verified = { sub: 'corp-sub-attr', preferred_username: 'attr-user', email: 'attr@corp.example', email_verified: true };
    const start = await app.request(`/auth/oidc/${provider.slug}/start`);
    const stateValue = new URL(start.headers.get('location') ?? '').searchParams.get('state') ?? '';
    const callback = await app.request(`/auth/oidc/${provider.slug}/callback?code=c&state=${encodeURIComponent(stateValue)}`);
    const cookie = /cs_session=([^;]*)/.exec(callback.headers.get('set-cookie') ?? '')?.[1] ?? '';

    const listed = await identity.api.readForwarding(passwordAdmin);
    expect(listed.candidates.find((c) => c.key === 'employee-no')).toMatchObject({ kind: 'mapped', providers: [provider.slug] });
    // 未被允许转发时，自定义字段只留在平台侧档案里。
    const before = await forwardUser('demo.cs.localhost', cookie);
    expect(before.headers.has('x-cs-user-attrs')).toBe(false);
    await identity.api.setGlobalForwarding(passwordAdmin, { fields: ['name', 'employee-no'] });
    const after = await forwardUser('demo.cs.localhost', cookie);
    // 只转发被允许的那一个字段：档案里还有 department，但它不在集合里。
    expect(JSON.parse(after.headers.get('x-cs-user-attrs') ?? '{}')).toEqual({ 'employee-no': 'E-9' });
    const claims = (await verifyWithJwks(after.headers.get(IDENTITY_HEADERS.identityToken) ?? '', await identity.api.jwks(), { audience: 'service:demo/demo' })).claims;
    expect(claims[TOKEN_CLAIMS.attrs]).toEqual({ 'employee-no': 'E-9' });
    expect(await codeOf(() => identity.api.setGlobalForwarding(passwordAdmin, { fields: ['not-a-mapped-field'] }))).toBe('forwarding-field-invalid');
  });

  test('工作台目标不受转发集约束，并带上本次会话的认证方式（业务目标没有这个头）', async () => {
    await identity.api.setGlobalForwarding(passwordAdmin, { fields: [] });
    const { cookie } = await loginWithPassword(app, identity, 'admin-one');
    const console_ = await forwardUser('console.cs.localhost', cookie);
    expect(console_.headers.get('x-cs-auth-method')).toBe('password');
    expect(console_.headers.get(IDENTITY_HEADERS.userEmail)).toBe('admin@corp.example');
    const business = await forwardUser('demo.cs.localhost', cookie);
    expect(business.headers.has('x-cs-auth-method')).toBe(false);
    expect(business.headers.has(IDENTITY_HEADERS.userEmail)).toBe(false);
    await identity.api.setGlobalForwarding(passwordAdmin, { fields: ['name', 'email'] });
  });
});

describe.skipIf(!available)('管理面路由的边界', () => {
  /**
   * 每条带请求体的管理面路由都要有**成功**分支的 HTTP 用例。
   * 实机撞过：一次 replace-all 把读体帮手改成了调用自己（`return await body(c)`），
   * 于是所有带体的路由都栈溢出并被 catch 成「请求体必须是 JSON」——而当时只有「体不是 JSON」
   * 这一条失败分支有用例，两种情况的响应一模一样，测试全绿，线上全坏。
   */
  test('带请求体的管理面路由：合法 JSON 真的被读到并落库', async () => {
    const admin = { 'x-cs-user-id': adminId, 'x-cs-auth-method': 'oidc', 'content-type': 'application/json' };
    const created = await app.request('/v1/admin/auth/providers', {
      method: 'POST', headers: admin,
      body: JSON.stringify({ slug: 'http-created', displayName: 'HTTP 建的', issuerUrl: ISSUER, clientId: 'cs', clientSecret: 's', scopes: 'openid', provisioning: 'auto' }),
    });
    expect(created.status).toBe(201);
    const dto = await created.json() as { id: string; slug: string };
    expect(dto.slug).toBe('http-created');

    const patched = await app.request(`/v1/admin/auth/providers/${dto.id}`, { method: 'PATCH', headers: admin, body: JSON.stringify({ displayName: 'HTTP 改的' }) });
    expect(patched.status).toBe(200);
    expect((await patched.json() as { displayName: string }).displayName).toBe('HTTP 改的');

    const forwarding = await app.request('/v1/admin/auth/forwarding', { method: 'PUT', headers: admin, body: JSON.stringify({ fields: ['name'] }) });
    expect(forwarding.status).toBe(200);
    expect((await forwarding.json() as { global: { fields: string[] } }).global.fields).toEqual(['name']);

    const override = await app.request(`/v1/admin/auth/forwarding/projects/${projectId}`, { method: 'PUT', headers: admin, body: JSON.stringify({ fields: ['name', 'email'] }) });
    expect(override.status).toBe(200);
    expect((await override.json() as { fields: string[] }).fields).toEqual(['email', 'name']);
    expect((await app.request(`/v1/admin/auth/forwarding/projects/${projectId}`, { method: 'DELETE', headers: admin })).status).toBe(200);

    const policy = await app.request('/v1/admin/auth/login-policy', { method: 'PUT', headers: admin, body: JSON.stringify({ passwordLoginEnabled: true }) });
    expect(policy.status).toBe(200);
    await identity.api.setGlobalForwarding(passwordAdmin, { fields: ['name', 'email'] });
  });

  test('非 JSON 请求体是 400 而不是 500；非管理员读写一律 403', async () => {
    const admin = { 'x-cs-user-id': adminId, 'x-cs-auth-method': 'oidc' };
    const bad = await app.request('/v1/admin/auth/providers', { method: 'POST', headers: { ...admin, 'content-type': 'application/json' }, body: 'not json' });
    expect(bad.status).toBe(400);
    const outsider = await seedLocalUser(tdb.db, { username: 'plain-user' });
    for (const path of ['/v1/admin/auth/login-policy', '/v1/admin/auth/providers', '/v1/admin/auth/forwarding']) {
      expect((await app.request(path, { headers: { 'x-cs-user-id': outsider } })).status).toBe(403);
    }
    // 认证方式缺省按密码处理：这只会更严（关不掉常规登录），不会放宽任何东西。
    const put = await app.request('/v1/admin/auth/login-policy', {
      method: 'PUT', headers: { 'x-cs-user-id': adminId, 'content-type': 'application/json' }, body: JSON.stringify({ passwordLoginEnabled: false }),
    });
    expect(put.status).toBe(403);
    expect(await put.json()).toMatchObject({ details: { code: 'password-login-requires-oidc-session' } });
  });

  test('管理面响应一律 no-store：改完策略不会被中间层缓存挡住', async () => {
    const response = await app.request('/v1/admin/auth/login-policy', { headers: { 'x-cs-user-id': adminId, 'x-cs-auth-method': 'oidc' } });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});

/**
 * 源码层用例：管理面每个带请求体的处理器都必须**先读体、再 await 别的东西**。
 * 理由是这条错误路径的行为不该依赖数据库：体不是 JSON 就该立刻 400，
 * 而不是先等一次「调用者是不是管理员」的往返，也不该随数据库延迟变化。
 */
test('管理面处理器先读请求体再做任何 await', () => {
  const source = readFileSync(new URL('../http/adminAuthRoutes.ts', import.meta.url), 'utf8')
    .split('\n').filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//') && !line.trim().startsWith('/**')).join('\n');
  const handlers = source.split(/\n  r\.(?=get|post|put|patch|delete)/).slice(1);
  for (const handler of handlers) {
    const bodyAt = handler.search(/await (readJsonBody\(c\)|parseBody\()/);
    if (bodyAt < 0) continue;
    const actorAt = handler.search(/await actor\(c\)/);
    const apiAt = handler.search(/await api\./);
    for (const [name, at] of [['actor(c)', actorAt], ['api.*', apiAt]] as const) {
      if (at >= 0) expect(bodyAt, `请求体必须在 ${name} 之前读：${handler.split('\n')[0]}`).toBeLessThan(at);
    }
  }
});
