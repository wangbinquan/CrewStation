import { describe, expect, spyOn, test } from 'bun:test';
import { createHash, randomBytes } from 'node:crypto';
import { importJWK, jwtVerify } from 'jose';
import { DEV_ROLES, findDevRole } from './roles';
import { createDevOidc } from './oidc';
import { renderDevAuthPage } from './page';
import { devAuthOidcIdentity, safeReturnTo, selectableProjects, startDevAuthServer } from './server';

describe('开发角色', () => {
  test('映射 CrewStation 的四个安全视角，不包含会转移所有权的 owner', () => {
    expect(DEV_ROLES.map((role) => role.key)).toEqual(['admin', 'developer', 'tester', 'member']);
    expect(DEV_ROLES.map((role) => role.memberRole)).toEqual([null, 'developer', 'tester', null]);
    expect(DEV_ROLES.map((role) => role.platformRole)).toEqual(['admin', 'developer', 'user', 'user']);
    expect(findDevRole('owner')).toBeUndefined();
  });

  test('没有项目仍可登录开发者自建，试用需要项目；播种失败时禁用全部登录', () => {
    const ready = renderDevAuthPage({ status: 'ready', startedAt: 1, projects: [] });
    expect(ready).toContain('data-testid="login-admin"');
    expect(ready).not.toContain('data-testid="login-developer" disabled');
    expect(ready).toContain('data-testid="login-tester" disabled');
    const failed = renderDevAuthPage({ status: 'error', startedAt: 1, projects: [], error: '登录失败 401' });
    expect(failed).toContain('登录失败 401');
    expect((failed.match(/disabled/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  test('只把未归档的数字人项目提供给开发者和测试者，并给写操作注入表单令牌', () => {
    const projects = selectableProjects([
      { id: 'p1', name: '数字人', slug: 'worker', kind: 'DigitalWorker', state: 'active', ownerUserId: 'u1' },
      { id: 'p2', name: '接入容器', slug: 'proxy', kind: 'APIProxy', state: 'active', ownerUserId: 'u1' },
      { id: 'p3', name: '旧项目', slug: 'old', kind: 'DigitalWorker', state: 'archived', ownerUserId: 'u1' },
    ]);
    expect(projects.map((project) => project.id)).toEqual(['p1']);
    const page = renderDevAuthPage({ status: 'ready', startedAt: 1, projects }, 'one-time-form-token');
    expect(page).toContain('name="csrf" value="one-time-form-token"');
    expect((page.match(/name="returnTo" value="\/"/g) ?? [])).toHaveLength(4);
    expect(page).toContain('action="/reseed"');
    expect(page).not.toContain('接入容器');
  });

  test('旧页面令牌失效时仍显示可重试的完整角色页，并清理 POST 地址', () => {
    const page = renderDevAuthPage({
      status: 'ready', startedAt: 1, projects: [], notice: '此前页面的安全令牌已失效，请重新点击要切换的角色。',
    }, 'fresh-token');
    expect(page).toContain('role="alert"');
    expect(page).toContain('页面已更新');
    expect(page).toContain('请重新点击要切换的角色');
    expect(page).toContain('name="csrf" value="fresh-token"');
    expect(page).toContain("history.replaceState(null,'','/')");
    expect(page).not.toContain('invalid form token');
  });

  test('回跳只接受站内绝对路径', () => {
    expect(safeReturnTo('/projects/p1')).toBe('/projects/p1');
    for (const value of ['https://evil.test', '//evil.test', '/\\evil', 'projects']) expect(safeReturnTo(value)).toBe('/');
  });
});

test('开发 IdP 完整校验 PKCE，并签发可由 JWKS 验证的 ID token', async () => {
  const origin = 'http://dev-idp.test';
  const oidc = await createDevOidc({
    issuer: () => `${origin}/oidc/test`,
    authorizationOrigin: () => origin,
    clientSecret: 'test-client-secret',
  });
  const call = (path: string, init?: RequestInit) => oidc.fetch(new Request(`${origin}${path}`, init), '/oidc/test');
  const discovery = await (await call('/oidc/test/.well-known/openid-configuration')).json() as { jwks_uri: string };
  expect(discovery.jwks_uri).toBe(`${origin}/oidc/test/jwks.json`);

  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const authorize = new URL(`${origin}/oidc/test/authorize`);
  authorize.search = new URLSearchParams({ client_id: 'crewstation-dev-auth', response_type: 'code', redirect_uri: 'http://console.test/callback', state: 's1', nonce: 'n1', code_challenge: challenge, code_challenge_method: 'S256', as: 'dev-role-admin' }).toString();
  const approved = await oidc.fetch(new Request(authorize), '/oidc/test');
  const callback = new URL(approved.headers.get('location') ?? '');
  const body = new URLSearchParams({ grant_type: 'authorization_code', client_id: 'crewstation-dev-auth', client_secret: 'test-client-secret', redirect_uri: 'http://console.test/callback', code: callback.searchParams.get('code') ?? '', code_verifier: verifier });
  const request = { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } };
  const token = await call('/oidc/test/token', request);
  expect(token.status).toBe(200);
  const tokens = await token.json() as { token_type: string; id_token: string };
  expect(tokens).toMatchObject({ token_type: 'Bearer' });
  const jwks = await (await call('/oidc/test/jwks.json')).json() as { keys: JsonWebKey[] };
  const key = await importJWK(jwks.keys[0] as JsonWebKey, 'RS256');
  expect((await jwtVerify(tokens.id_token, key, { issuer: `${origin}/oidc/test`, audience: 'crewstation-dev-auth' })).payload.sub).toBe('dev-role-admin');
  expect((await call('/oidc/test/token', request)).status).toBe(400);
});

test('开发 IdP 未指定角色时使用整卡按钮，并保留原 OAuth 参数', async () => {
  const origin = 'http://dev-idp.test';
  const oidc = await createDevOidc({
    issuer: () => `${origin}/oidc/test`,
    authorizationOrigin: () => origin,
    clientSecret: 'test-client-secret',
  });
  const authorize = new URL(`${origin}/oidc/test/authorize`);
  authorize.search = new URLSearchParams({
    client_id: 'crewstation-dev-auth', response_type: 'code', redirect_uri: 'http://console.test/callback',
    state: 'state-value', nonce: 'nonce-value', code_challenge: 'challenge-value', code_challenge_method: 'S256',
  }).toString();

  const response = await oidc.fetch(new Request(authorize), '/oidc/test');
  const page = await response.text();

  expect(response.status).toBe(200);
  expect(page).toContain('<h1>选择开发角色</h1>');
  expect(page).toContain('class="oidc-role-option role-admin"');
  expect(page).toContain('data-testid="choose-admin"');
  expect(page).toContain('name="state" value="state-value"');
  expect(page).toContain('name="code_challenge" value="challenge-value"');
  expect(page).toContain('name="as" value="dev-role-admin"');
  expect(page.match(/class="oidc-role-option/g)).toHaveLength(4);
  expect(page).not.toContain('<li><a');
});

test('生产源码不包含开发 Provider 或固定账号', async () => {
  const source = new Bun.Glob('**/*.{ts,tsx,js,jsx,json,yaml,yml,sh}');
  const violations: string[] = [];
  // RFC-010 的已安装对象目录仅登记部署名；这不等于把本机 Provider、账号或登录流程放入生产。
  const componentMetadata = new Set(['modules/platform/domain/systemComponents.ts', 'modules/platform/tests/clusterManagement.test.ts']);
  let scanned = 0;
  for (const root of ['apps', 'modules', 'packages', 'runtimes']) {
    for await (const path of source.scan({ cwd: root, onlyFiles: true })) {
      scanned += 1;
      const fullPath = `${root}/${path}`, text = await Bun.file(fullPath).text();
      const hasIdentity = /dev-roles|dev-role-(?:admin|developer|tester|member)/.test(text);
      const hasRuntimeReference = /crewstation-dev-auth/.test(text) && !componentMetadata.has(fullPath);
      if (hasIdentity || hasRuntimeReference) violations.push(fullPath);
    }
  }
  expect(scanned).toBeGreaterThan(0);
  expect(violations).toEqual([]);
});

test('本机清单不再拿 publishNotReadyAddresses 防自锁，就绪只看端口', async () => {
  const manifest = await Bun.file('deploy/local/dev-auth.yaml').text();
  expect(manifest).toContain('path: /readyz');
  // 注释里还会提到它（记录为什么拿掉），所以只看字段本身在不在。
  expect(manifest).not.toMatch(/^\s*publishNotReadyAddresses:/m);
});

describe('开发 IdP 的身份要能跨重启不变', () => {
  const restoreEnv = (): void => {
    delete process.env.CS_DEV_AUTH_ROUTE_ID;
    delete process.env.CS_DEV_AUTH_CLIENT_SECRET;
  };

  test('配齐就用固定前缀与口令，平台里那条 Provider 才能活过重启', () => {
    restoreEnv();
    expect(devAuthOidcIdentity({ routeId: 'abc12345', clientSecret: 'fixed-client-secret' }))
      .toEqual({ routePrefix: '/oidc/abc12345', clientSecret: 'fixed-client-secret' });
  });

  test('没配就退回临时值，并把「重启后要重新注册」说出来', () => {
    restoreEnv();
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const first = devAuthOidcIdentity();
      const second = devAuthOidcIdentity();
      expect(first.routePrefix).toMatch(/^\/oidc\/[0-9a-f]{12}$/);
      expect(second.routePrefix).not.toBe(first.routePrefix);
      expect(warn.mock.calls.flat().join(' ')).toContain('CS_DEV_AUTH_ROUTE_ID');
    } finally {
      warn.mockRestore();
    }
  });

  test('前缀只收小写字母数字，挡住能改路由形状的取值', () => {
    restoreEnv();
    for (const routeId of ['short', 'UPPERCASE1', 'has-dash-1', '../escape', 'a'.repeat(65)]) {
      expect(() => devAuthOidcIdentity({ routeId, clientSecret: 's' })).toThrow('CS_DEV_AUTH_ROUTE_ID');
    }
  });
});

test('播种失败不再拖垮 IdP：端口就绪，discovery 仍在固定前缀上应答', async () => {
  const server = await startDevAuthServer({
    port: 0, routeId: 'fixedroute01', clientSecret: 'fixed-client-secret',
    // 127.0.0.1:1 必定拒绝连接，等价于本机那次「密码登录关了，播种进不去」。
    platformOrigin: 'http://127.0.0.1:1', adminUsername: 'dev-admin', adminPassword: 'not-used',
    publicOrigin: 'http://dev-auth.test', internalOrigin: 'http://dev-auth.internal:7460', consoleOrigin: 'http://console.test',
    seedRetries: 0,
  });
  try {
    const base = `http://127.0.0.1:${server.port}`;
    expect(server.routePrefix).toBe('/oidc/fixedroute01');
    expect((await fetch(`${base}/readyz`)).status).toBe(200);
    const discovery = await fetch(`${base}/oidc/fixedroute01/.well-known/openid-configuration`);
    expect(discovery.status).toBe(200);
    expect(await discovery.json()).toMatchObject({
      issuer: 'http://dev-auth.internal:7460/oidc/fixedroute01',
      authorization_endpoint: 'http://dev-auth.test/oidc/fixedroute01/authorize',
      jwks_uri: 'http://dev-auth.internal:7460/oidc/fixedroute01/jwks.json',
    });

    let state: { status: string; error?: string } = { status: 'pending' };
    for (let attempt = 0; attempt < 200 && state.status !== 'error'; attempt += 1) {
      state = await (await fetch(`${base}/status.json`)).json() as typeof state;
      if (state.status !== 'error') await Bun.sleep(25);
    }
    expect(state.status).toBe('error');
    expect((await fetch(`${base}/readyz`)).status).toBe(200);
    expect(await (await fetch(`${base}/`)).text()).toContain('准备失败');
  } finally {
    server.stop();
  }
});

test('安装脚本沿用已有前缀与口令，并单独核对播种结果', async () => {
  const script = await Bun.file('deploy/local/install-dev-auth.sh').text();
  for (const key of ['CS_DEV_AUTH_ROUTE_ID', 'CS_DEV_AUTH_CLIENT_SECRET']) {
    expect(script).toContain(`jsonpath='{.data.${key}}'`);
    expect(script).toContain(`--from-literal=${key}=`);
  }
  expect(script).toContain('/status.json');
});

test('播种撞上平台缓存时自动重试，重试用尽才判失败', async () => {
  const hits: string[] = [];
  const platform = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: (request) => {
    hits.push(new URL(request.url).pathname);
    return Response.json({ message: '用户名密码登录已被管理员关闭' }, { status: 403 });
  } });
  const logged = spyOn(console, 'error').mockImplementation(() => {});
  const server = await startDevAuthServer({
    port: 0, routeId: 'retryroute01', clientSecret: 'fixed-client-secret',
    platformOrigin: `http://127.0.0.1:${platform.port}`, adminUsername: 'dev-admin', adminPassword: 'not-used',
    consoleOrigin: 'http://console.test', seedRetries: 2, seedRetryDelayMs: 10,
  });
  try {
    const base = `http://127.0.0.1:${server.port}`;
    let state: { status: string } = { status: 'pending' };
    for (let attempt = 0; attempt < 200 && state.status !== 'error'; attempt += 1) {
      state = await (await fetch(`${base}/status.json`)).json() as typeof state;
      if (state.status !== 'error') await Bun.sleep(25);
    }
    expect(state.status).toBe('error');
    // 首轮＋两次重试，每轮都从管理员登录重新开始。
    expect(hits.filter((path) => path === '/auth/login')).toHaveLength(3);
    expect((await fetch(`${base}/readyz`)).status).toBe(200);
    const said = logged.mock.calls.flat().join(' ');
    expect(said).toContain('稍后重试');
    expect(said).toContain('不再重试');
  } finally {
    logged.mockRestore();
    server.stop();
    platform.stop(true);
  }
});
