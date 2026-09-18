import { describe, expect, test } from 'bun:test';
import { IDENTITY_HEADERS } from '@crewstation/contracts';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { createApp } from './createApp';
import { devSessionIdentity } from './devSessionIdentity';
import { devSessionScopeDenial } from './devSessionScope';
import type { AppEnv } from './identity';
import { requireService, requireUser } from './identity';

const scope = { projectId: 'prj_a', serviceId: 'svc_a' };
const principal = { userId: 'usr_1', name: 'Ada', email: 'ada@example.com', taskId: 'tsk_1', ...scope };

/** 与 cs-api 同序：createApp 的身份头中间件在前，令牌中间件经 route('/') 挂在业务路由之前。 */
function app(): Hono<AppEnv> {
  const hono = createApp({ name: 'test' });
  const gate = new Hono<AppEnv>();
  gate.use('*', devSessionIdentity(async (token) => (token === 'good' ? principal : undefined)));
  hono.route('/', gate);
  const probe = new Hono<AppEnv>();
  const user = (c: Context<AppEnv>) => c.json(requireUser(c));
  probe.get('/v1/projects', user);
  probe.get('/v1/projects/:projectId/branches', user);
  probe.post('/v1/projects/:projectId/publish', user);
  probe.get('/v1/svc', (c) => c.json(requireService(c)));
  hono.route('/', probe);
  return hono;
}

async function get(path: string, token?: string, method = 'GET'): Promise<Response> {
  const headers: Record<string, string> = { [IDENTITY_HEADERS.sourceService]: 'demo/demo' };
  if (token) headers[IDENTITY_HEADERS.devSessionToken] = token;
  return app().request(path, { method, headers });
}

const denial = (method: string, url: string): string | undefined => devSessionScopeDenial(method, new URL(url, 'http://api.test'), scope);

describe('开发会话令牌中间件', () => {
  test('没带令牌的请求原样通过，服务身份不受影响', async () => {
    const res = await get('/v1/svc');
    expect(await res.json()).toMatchObject({ kind: 'service', project: 'demo' });
  });

  test('令牌无效时 401，且错误体是平台统一形状', async () => {
    const res = await get('/v1/projects/prj_a/branches', 'bad');
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: 'unauthenticated' });
  });

  test('令牌有效时改判为用户身份，盖掉网关注入的服务身份', async () => {
    const res = await get('/v1/projects/prj_a/branches', 'good');
    expect(res.status).toBe(200);
    // 开发会话令牌不是一次浏览器登录，认证方式按常规登录记（只会更严，不会放宽）。
    expect(await res.json()).toEqual({ kind: 'user', userId: 'usr_1', name: 'Ada', email: 'ada@example.com', authMethod: 'password', devSession: { taskId: 'tsk_1', projectId: 'prj_a', serviceId: 'svc_a' } });
    expect((await get('/v1/projects/prj_a/publish', 'good', 'POST')).status).toBe(200);
  });

  test('换个项目就 403', async () => {
    const res = await get('/v1/projects/prj_b/branches', 'good');
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'forbidden' });
  });
});

describe('开发会话令牌可用接口白名单', () => {
  test('工具用得到的几条按项目或服务绑定后放行', () => {
    for (const path of ['/v1/projects/prj_a/dev-session', '/v1/projects/prj_a/branches', '/v1/projects/prj_a/logs?source=slot', '/v1/projects/prj_a/health', '/v1/projects/prj_a/capabilities']) {
      expect(denial('GET', path)).toBeUndefined();
    }
    expect(denial('POST', '/v1/projects/prj_a/publish')).toBeUndefined();
    expect(denial('GET', '/v1/services/svc_a/slots')).toBeUndefined();
    expect(denial('GET', '/v1/catalog/operations?serviceId=svc_a')).toBeUndefined();
    // slug 换 ID 的那一步不绑项目：只读，且返回的本来就只有本人可见的项目。
    expect(denial('GET', '/v1/projects')).toBeUndefined();
  });

  test('别的项目、别的服务、不带 serviceId 的目录查询都拒绝', () => {
    expect(denial('GET', '/v1/projects/prj_b/logs')).toContain('prj_b');
    expect(denial('GET', '/v1/projects/prj_b/capabilities')).toContain('prj_b');
    expect(denial('GET', '/v1/services/svc_b/slots')).toContain('svc_b');
    expect(denial('GET', '/v1/catalog/operations')).toContain('必须指明');
    expect(denial('GET', `/v1/projects/${encodeURIComponent('prj_b')}/branches`)).toBeDefined();
  });

  test('白名单之外的接口一律拒绝，含本项目的写操作与看似同族的路径', () => {
    for (const [method, path] of [['PUT', '/v1/projects/prj_a/members'], ['DELETE', '/v1/projects/prj_a/dev-session'], ['POST', '/v1/services/svc_a/traffic-switch'], ['GET', '/v1/users'], ['GET', '/v1/projects/prj_a/branches/extra']] as const) {
      expect(denial(method, path)).toContain('只开放操作 MCP 工具所需的少数接口');
    }
  });
});
