import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HttpDeps, TaskResource } from './platform-admin-session';
import { DEV_ADMIN_SUB, adminCredentials, adminSession, httpClusterOps } from './platform-admin-session';

const CONSOLE = 'http://console.cs.localhost';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function root(adminEnv?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'cs-admin-session-'));
  roots.push(dir);
  if (adminEnv !== undefined) { mkdirSync(join(dir, '.local')); writeFileSync(join(dir, '.local/admin.env'), adminEnv); }
  return dir;
}

type Route = (request: { url: URL; method: string; headers: Headers; body: string }) => Response | undefined;

/** 按路由应答的假 fetch；记下每个请求，没有路由接住的一律 404。 */
function fakeFetch(routes: Route[]) {
  const seen: { method: string; url: string; cookie: string | null; body: string }[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input)), method = init?.method ?? 'GET', headers = new Headers(init?.headers);
    const body = init?.body === undefined || init.body === null ? '' : String(init.body);
    seen.push({ method, url: url.toString(), cookie: headers.get('cookie'), body });
    for (const route of routes) { const response = route({ url, method, headers, body }); if (response) return response; }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { impl, seen };
}

const redirect = (location: string, cookie?: string) => new Response(null, { status: 302, headers: { location, ...(cookie ? { 'set-cookie': `${cookie}; Path=/; HttpOnly` } : {}) } });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const me = (roles: Record<string, string>): Route => ({ url, headers }) => url.pathname === '/v1/me' ? json({ platformRole: roles[headers.get('cookie') ?? ''] ?? 'user' }) : undefined;

function deps(fetchImpl: typeof fetch, dir: string, env: Record<string, string> = {}): HttpDeps & { clock: { t: number } } {
  const clock = { t: 0 };
  return { fetch: fetchImpl, consoleUrl: CONSOLE, root: dir, env, sleep: async (ms) => { clock.t += ms; }, now: () => clock.t, clock };
}

describe('管理员凭据', () => {
  test('环境变量优先，其次 .local/admin.env；用户名缺省 platform-admin；没有口令就没有凭据', () => {
    const file = root('CS_BOOTSTRAP_ADMIN_USERNAME=from-file\nCS_BOOTSTRAP_ADMIN_PASSWORD=file-secret\n');
    expect(adminCredentials(file, {})).toEqual({ username: 'from-file', password: 'file-secret' });
    expect(adminCredentials(file, { CS_ADMIN_USERNAME: 'env-user', CS_ADMIN_PASSWORD: 'env-secret' })).toEqual({ username: 'env-user', password: 'env-secret' });
    expect(adminCredentials(root(), { CS_ADMIN_PASSWORD: 'only-password' })).toEqual({ username: 'platform-admin', password: 'only-password' });
    expect(adminCredentials(root(), {})).toBeUndefined();
  });
});

describe('以管理员身份登录', () => {
  const devRoles: Route[] = [
    ({ url }) => url.pathname === '/auth/oidc/dev-roles/start' ? redirect('http://dev-auth.cs.localhost/dev-roles/authorize?client_id=c&state=s') : undefined,
    ({ url }) => url.host === 'dev-auth.cs.localhost' && url.searchParams.get('as') === DEV_ADMIN_SUB ? redirect(`${CONSOLE}/auth/oidc/dev-roles/callback?code=k&state=s`) : undefined,
    ({ url }) => url.pathname === '/auth/oidc/dev-roles/callback' ? redirect('/', 'cs_session=from-oidc') : undefined,
  ];

  test('有口令时先用口令登录，并确认登录后是平台管理员', async () => {
    const http = fakeFetch([({ url, method }) => url.pathname === '/auth/login' && method === 'POST' ? redirect('/', 'cs_session=from-password') : undefined, me({ 'cs_session=from-password': 'admin' })]);
    expect(await adminSession(deps(http.impl, root(), { CS_ADMIN_PASSWORD: 'secret' }))).toBe('cs_session=from-password');
    expect(http.seen[0]!.body).toBe('username=platform-admin&password=secret');
  });

  test('口令登录被管理员关掉时，走本机开发角色登录器以平台管理员登录', async () => {
    const http = fakeFetch([({ url }) => url.pathname === '/auth/login' ? json({ error: { message: '用户名密码登录已被管理员关闭' } }, 403) : undefined, ...devRoles, me({ 'cs_session=from-oidc': 'admin' })]);
    expect(await adminSession(deps(http.impl, root(), { CS_ADMIN_PASSWORD: 'secret' }))).toBe('cs_session=from-oidc');
    expect(http.seen.some((r) => r.url.includes(`as=${DEV_ADMIN_SUB}`))).toBe(true);
  });

  test('没有口令时直接走开发角色登录，不拿空口令去试', async () => {
    const http = fakeFetch([...devRoles, me({ 'cs_session=from-oidc': 'admin' })]);
    expect(await adminSession(deps(http.impl, root()))).toBe('cs_session=from-oidc');
    expect(http.seen.some((r) => r.url.endsWith('/auth/login'))).toBe(false);
  });

  test('两条都不通时报出每条的原因；登录后的身份不是平台管理员也算失败', async () => {
    const refused = fakeFetch([({ url }) => url.pathname === '/auth/login' ? json({ error: { message: '口令不对' } }, 401) : undefined]);
    await expect(adminSession(deps(refused.impl, root(), { CS_ADMIN_PASSWORD: 'x' }))).rejects.toThrow(/口令登录：HTTP 401 口令不对；开发角色登录：平台没有给出开发角色的授权地址/);
    const demoted = fakeFetch([...devRoles, me({ 'cs_session=from-oidc': 'developer' })]);
    await expect(adminSession(deps(demoted.impl, root()))).rejects.toThrow('开发角色登录：登录后的身份不是平台管理员（developer）');
  });
});

describe('集群管理的运维操作', () => {
  const pod = { namespace: 'cs-demo', name: 'task-r-1', uid: 'uid-1' };
  const item = (uid: string): TaskResource => ({ resourceId: `res-${uid}`, uid, purpose: 'development-workspace', taskId: 'env-1', availableActions: [] });

  test('按命名空间与名字查，再按 uid 认；盘点里还没有就请求刷新，等它出现', async () => {
    let refreshed = false;
    const http = fakeFetch([
      ({ url, method }) => url.pathname === '/v1/admin/cluster/refresh' && method === 'POST' ? (refreshed = true, json({}, 202)) : undefined,
      ({ url }) => url.pathname === '/v1/admin/cluster/resources' ? json({ items: refreshed ? [item('other'), item('uid-1')] : [item('other')] }) : undefined,
    ]);
    const context = deps(http.impl, root());
    const found = await httpClusterOps(context, 'cs_session=a').findPod(pod);
    expect(found?.resourceId).toBe('res-uid-1');
    const query = new URL(http.seen[0]!.url).searchParams;
    expect([query.get('kind'), query.get('namespace'), query.get('q')]).toEqual(['Pod', 'cs-demo', 'task-r-1']);
    expect(http.seen.every((r) => r.cookie === 'cs_session=a')).toBe(true);
    expect(context.clock.t).toBe(3000);
  });

  test('先检查再执行：带上检查编号、幂等键与动作，轮询到终态为止', async () => {
    let polls = 0;
    const http = fakeFetch([
      ({ url }) => url.pathname === '/v1/admin/cluster/resources/res-uid-1/inspect-operation' ? json({ inspectionId: 'insp-1', capability: { action: 'restart', enabled: true, reason: '' } }) : undefined,
      ({ url, method }) => url.pathname === '/v1/admin/cluster/operations' && method === 'POST' ? json({ operationId: 'op-1', phase: 'queued', reason: '' }, 202) : undefined,
      ({ url }) => url.pathname === '/v1/admin/cluster/operations/op-1' ? json({ operationId: 'op-1', phase: ++polls < 3 ? 'observing' : 'succeeded', reason: polls < 3 ? '' : '会话已就绪' }) : undefined,
    ]);
    expect(await httpClusterOps(deps(http.impl, root()), 'c').run(item('uid-1'), 'restart', 'calico-migration:uid-1:restart')).toEqual({ phase: 'succeeded', reason: '会话已就绪' });
    expect(JSON.parse(http.seen[0]!.body)).toEqual({ action: 'restart' });
    expect(JSON.parse(http.seen[1]!.body)).toEqual({ inspectionId: 'insp-1', idempotencyKey: 'calico-migration:uid-1:restart', params: { action: 'restart' } });
  });

  test('检查说不能做就不执行，带回理由；执行十分钟不结束就停止等待；接口出错带上路径与状态', async () => {
    const refused = fakeFetch([({ url }) => url.pathname.endsWith('/inspect-operation') ? json({ inspectionId: 'i', capability: { action: 'restart', enabled: false, reason: '会话正在恢复' } }) : undefined]);
    expect(await httpClusterOps(deps(refused.impl, root()), 'c').run(item('uid-1'), 'restart', 'k')).toEqual({ phase: 'skipped', reason: '会话正在恢复' });
    expect(refused.seen.some((r) => r.url.endsWith('/v1/admin/cluster/operations'))).toBe(false);
    const stuck = fakeFetch([
      ({ url }) => url.pathname.endsWith('/inspect-operation') ? json({ inspectionId: 'i', capability: { action: 'delete', enabled: true, reason: '' } }) : undefined,
      ({ url }) => url.pathname.startsWith('/v1/admin/cluster/operations') ? json({ operationId: 'op', phase: 'executing', reason: '等领域回执' }) : undefined,
    ]);
    expect(await httpClusterOps(deps(stuck.impl, root()), 'c').run(item('uid-1'), 'delete', 'k')).toEqual({ phase: 'executing', reason: '十分钟内没有结束：等领域回执' });
    const broken = fakeFetch([]);
    await expect(httpClusterOps(deps(broken.impl, root()), 'c').run(item('uid-1'), 'delete', 'k')).rejects.toThrow('POST /v1/admin/cluster/resources/res-uid-1/inspect-operation：HTTP 404');
  });
});
