import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { UserId, WorkloadIdentity } from '@crewstation/contracts';
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
const settings = { adminEmails: [] as string[], userDomain: 'cs.localhost', cookieDomain: '.cs.localhost', secure: false, sessionTtlSeconds: 3600 };
const workloads: Record<string, WorkloadIdentity> = {
  '10.244.0.23': { identity: 'demo/demo', project: 'demo', service: 'demo', kind: 'service', slot: 'prod' },
  '10.244.0.40': { identity: 'demo/demo', project: 'demo', service: 'demo', kind: 'dev-session' },
};
const testers = new Set<string>();
let tdb: TestDatabase;
let identity: IdentityModule;
let app: Hono<AppEnv>;
let aliceCookie: string;
let aliceId: UserId;

function moduleOn(db: TestDatabase['db']): IdentityModule {
  return createIdentityModule({
    db,
    settings,
    provider: demoIdentityProvider(),
    previewAccess: { canView: async (userId, slug) => testers.has(`${userId}@${slug}`) },
    workloadLookup: { byIp: async (ip) => workloads[ip] },
    allowlistEvaluator: {
      evaluate: async (caller, target) => {
        if (target.host === 'api.svc.cs.internal') return { allowed: true, targetIdentity: 'platform-api' };
        if (target.host === 'other.svc.cs.internal' && target.method === 'GET') return { allowed: true, targetIdentity: 'other/other' };
        return { allowed: false, reason: `${caller.identity} 未被放行调用 ${target.method} ${target.host}${target.path}`, targetIdentity: 'other/other' };
      },
    },
  });
}

function mount(module: IdentityModule): Hono<AppEnv> {
  const hono = createApp({ name: 'test' });
  for (const router of [...module.http.auth, ...module.http.forwardAuth]) hono.route('/', router);
  return hono;
}

async function login(username: string, extra: Record<string, string> = {}): Promise<{ cookie: string; userId: UserId }> {
  const res = await app.request('/auth/login', { method: 'POST', body: new URLSearchParams({ username, ...extra }) });
  const cookie = /cs_session=([^;]*)/.exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
  const user = await identity.api.resolveSession(cookie);
  return { cookie, userId: user!.id };
}

async function forwardUser(host: string, extra: Record<string, string> = {}): Promise<Response> {
  return app.request('/forward-auth/user', { headers: { 'x-forwarded-proto': 'http', 'x-forwarded-host': host, 'x-forwarded-uri': '/path?q=1', 'x-forwarded-method': 'GET', ...extra } });
}

async function forwardService(extra: Record<string, string>): Promise<Response> {
  return app.request('/forward-auth/service', { headers: { 'x-forwarded-proto': 'http', 'x-forwarded-method': 'GET', 'x-forwarded-uri': '/v1/things?limit=1', ...extra } });
}

beforeAll(async () => {
  if (!available) return;
  tdb = await createTestDatabase([identityMigrations]);
  identity = moduleOn(tdb.db);
  app = mount(identity);
  ({ cookie: aliceCookie, userId: aliceId } = await login('alice'));
});
afterAll(async () => { await tdb?.drop(); });

describe.skipIf(!available)('forward-auth user domain', () => {
  test('未登录：浏览器导航 302 到工作台登录页并带原始地址；非浏览器 401', async () => {
    const browser = await forwardUser('demo.cs.localhost', { accept: 'text/html,application/xhtml+xml' });
    expect(browser.status).toBe(302);
    expect(browser.headers.get('location')).toBe('http://console.cs.localhost/auth/login?returnTo=http%3A%2F%2Fdemo.cs.localhost%2Fpath%3Fq%3D1');
    const api = await forwardUser('demo.cs.localhost', { accept: 'application/json' });
    expect(api.status).toBe(401);
    expect(await api.json()).toMatchObject({ error: 'unauthenticated' });
  });

  test('已登录访问 prod 主机：200 并注入四个身份头与 requestId，令牌 aud 绑定目标服务', async () => {
    const res = await forwardUser('demo.cs.localhost', { cookie: `cs_session=${aliceCookie}`, [IDENTITY_HEADERS.requestId]: 'req-1' });
    expect(res.status).toBe(200);
    expect(res.headers.get(IDENTITY_HEADERS.userId)).toBe(aliceId);
    expect(res.headers.get(IDENTITY_HEADERS.userName)).toBe('alice');
    expect(res.headers.get(IDENTITY_HEADERS.userEmail)).toBe('alice@demo.invalid');
    expect(res.headers.get(IDENTITY_HEADERS.requestId)).toBe('req-1');
    const token = res.headers.get(IDENTITY_HEADERS.identityToken) ?? '';
    const verified = await verifyWithJwks(token, await identity.api.jwks(), { audience: 'service:demo/demo', issuer: TOKEN_CLAIMS.issuer });
    expect(verified.subject).toBe(`user:${aliceId}`);
    expect(verified.claims).toMatchObject({ cs_kind: 'user', name: 'alice', email: 'alice@demo.invalid', cs_project: 'demo', cs_slot: 'prod' });
    expect(verified.expiresAt - verified.issuedAt).toBe(300);
  });

  test('工作台主机：aud=console，不带项目声明；未知主机 403', async () => {
    const res = await forwardUser('console.cs.localhost', { cookie: `cs_session=${aliceCookie}` });
    expect(res.status).toBe(200);
    const verified = await verifyWithJwks(res.headers.get(IDENTITY_HEADERS.identityToken) ?? '', await identity.api.jwks(), { audience: 'console' });
    expect(verified.claims).not.toHaveProperty('cs_project');
    expect((await forwardUser('evil.example.com', { cookie: `cs_session=${aliceCookie}` })).status).toBe(403);
  });

  test('无权访问 preview：浏览器导航得到带原因与返回工作台的 HTML，程序调用仍是 JSON', async () => {
    const html = await forwardUser('preview.demo.cs.localhost', { cookie: `cs_session=${aliceCookie}`, accept: 'text/html,application/xhtml+xml' });
    expect(html.status).toBe(403); expect(html.headers.get('content-type') ?? '').toContain('text/html');
    const body = await html.text();
    expect(body).toContain('没有项目 demo 的 preview 访问权限'); expect(body).toContain('href="http://console.cs.localhost/"'); expect(body).toContain('返回工作台');
    const json = await forwardUser('preview.demo.cs.localhost', { cookie: `cs_session=${aliceCookie}`, accept: 'application/json' });
    expect(json.status).toBe(403); expect(await json.json()).toMatchObject({ error: 'forbidden' });
  });
  test('preview 与 dev 主机要求成员或测试者：无权 403，有权 200 且 cs_slot 正确', async () => {
    expect((await forwardUser('preview.demo.cs.localhost', { cookie: `cs_session=${aliceCookie}` })).status).toBe(403);
    expect((await forwardUser('dev.demo.cs.localhost', { cookie: `cs_session=${aliceCookie}` })).status).toBe(403);
    testers.add(`${aliceId}@demo`);
    const preview = await forwardUser('preview.demo.cs.localhost', { cookie: `cs_session=${aliceCookie}` });
    expect(preview.status).toBe(200);
    const verified = await verifyWithJwks(preview.headers.get(IDENTITY_HEADERS.identityToken) ?? '', await identity.api.jwks(), { audience: 'service:demo/demo' });
    expect(verified.claims).toMatchObject({ cs_slot: 'preview' });
    expect((await forwardUser('dev.demo.cs.localhost', { cookie: `cs_session=${aliceCookie}` })).status).toBe(200);
  });

  test('非 ASCII 显示名：头按 RFC 8187 编码，令牌保留原文', async () => {
    const { cookie } = await login('zhang', { displayName: '张三' });
    const res = await forwardUser('demo.cs.localhost', { cookie: `cs_session=${cookie}` });
    expect(res.status).toBe(200);
    expect(res.headers.get(IDENTITY_HEADERS.userName)).toBe("UTF-8''%E5%BC%A0%E4%B8%89");
    const verified = await verifyWithJwks(res.headers.get(IDENTITY_HEADERS.identityToken) ?? '', await identity.api.jwks(), { audience: 'service:demo/demo' });
    expect(verified.claims.name).toBe('张三');
  });

  test('伪造或损坏的会话 Cookie：按未登录处理并清 Cookie', async () => {
    const res = await forwardUser('demo.cs.localhost', { cookie: 'cs_session=garbage', accept: 'text/html' });
    expect(res.status).toBe(302);
    expect(res.headers.get('set-cookie')).toMatch(/^cs_session=;.*Max-Age=0/);
    const [h = '', p = '', s = ''] = aliceCookie.split('.');
    const tampered = `${h}.${p}.${s.slice(0, 10)}${s[10] === 'A' ? 'B' : 'A'}${s.slice(11)}`;
    expect((await forwardUser('demo.cs.localhost', { cookie: `cs_session=${tampered}`, accept: 'application/json' })).status).toBe(401);
  });
});

describe.skipIf(!available)('forward-auth service domain', () => {
  test('缺少或未登记的源 IP → 403', async () => {
    expect((await forwardService({ 'x-forwarded-host': 'other.svc.cs.internal' })).status).toBe(403);
    const unknown = await forwardService({ 'x-forwarded-for': '10.244.9.9', 'x-forwarded-host': 'other.svc.cs.internal' });
    expect(unknown.status).toBe(403);
    expect(await unknown.json()).toMatchObject({ error: 'forbidden', details: { reason: 'unknown-workload' } });
  });

  test('放行表拒绝 → 403 并带原因', async () => {
    const res = await forwardService({ 'x-forwarded-for': '10.244.0.23', 'x-forwarded-host': 'other.svc.cs.internal', 'x-forwarded-method': 'DELETE' });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'forbidden', message: 'demo/demo 未被放行调用 DELETE other.svc.cs.internal/v1/things' });
  });

  test('放行 → 200：来源服务、槽、来源令牌（sub/aud/cs_*）与透传的 trace_id', async () => {
    const traceId = '0123456789abcdef0123456789abcdef';
    const res = await forwardService({ 'x-forwarded-for': '10.244.0.23, 10.244.0.7', 'x-forwarded-host': 'other.svc.cs.internal', [IDENTITY_HEADERS.traceId]: traceId });
    expect(res.status).toBe(200);
    expect(res.headers.get(IDENTITY_HEADERS.sourceService)).toBe('demo/demo');
    expect(res.headers.get(IDENTITY_HEADERS.sourceSlot)).toBe('prod');
    expect(res.headers.get(IDENTITY_HEADERS.traceId)).toBe(traceId);
    expect(res.headers.get(IDENTITY_HEADERS.requestId)).toBeTruthy();
    const verified = await verifyWithJwks(res.headers.get(IDENTITY_HEADERS.sourceToken) ?? '', await identity.api.jwks(), { audience: 'service:other/other', issuer: TOKEN_CLAIMS.issuer });
    expect(verified.subject).toBe('service:demo/demo');
    expect(verified.claims).toMatchObject({ cs_kind: 'service', cs_project: 'demo', cs_slot: 'prod', cs_trace_id: traceId });
  });

  test('开发会话调用平台 API：无槽头，aud=platform-api，非法 trace_id 被替换为新的', async () => {
    const res = await forwardService({ 'x-forwarded-for': '10.244.0.40', 'x-forwarded-host': 'api.svc.cs.internal', [IDENTITY_HEADERS.traceId]: 'not-hex' });
    expect(res.status).toBe(200);
    expect(res.headers.get(IDENTITY_HEADERS.sourceSlot)).toBeNull();
    expect(res.headers.get(IDENTITY_HEADERS.traceId)).toMatch(/^[0-9a-f]{32}$/);
    const verified = await verifyWithJwks(res.headers.get(IDENTITY_HEADERS.sourceToken) ?? '', await identity.api.jwks(), { audience: 'platform-api' });
    expect(verified.claims).toMatchObject({ cs_kind: 'dev-session', cs_project: 'demo' });
    expect(verified.claims).not.toHaveProperty('cs_slot');
  });
});

describe.skipIf(!available)('signing keys', () => {
  test('同一数据库上的第二个实例读到同一把钥；轮换后旧会话仍有效、JWKS 含两把公钥、新令牌用新 kid', async () => {
    const second = moduleOn(tdb.db);
    expect((await second.api.jwks()).keys.map((k) => k.kid)).toEqual((await identity.api.jwks()).keys.map((k) => k.kid));
    expect((await second.api.resolveSession(aliceCookie))?.id).toBe(aliceId);
    const before = (await identity.api.jwks()).keys[0]?.kid;
    const { kid } = await identity.api.rotateSigningKey();
    expect(kid).not.toBe(before);
    expect((await identity.api.jwks()).keys.map((k) => k.kid)).toEqual([kid, before]);
    expect((await identity.api.resolveSession(aliceCookie))?.id).toBe(aliceId);
    const { cookie } = await login('alice');
    const verified = await verifyWithJwks(cookie, await identity.api.jwks(), { audience: 'session' });
    expect(verified.kid).toBe(kid);
    // 另一副本尚未感知轮换：遇到未知 kid 时重读密钥环后验签成功。
    expect((await second.api.resolveSession(cookie))?.id).toBe(aliceId);
    expect((await second.api.jwks()).keys.length).toBe(2);
  });
});
