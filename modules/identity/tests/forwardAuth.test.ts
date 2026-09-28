import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { ProjectId, TaskId, UserId, WorkloadIdentity } from '@crewstation/contracts';
import { IDENTITY_HEADERS, TOKEN_CLAIMS } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { verifyWithJwks } from '@crewstation/jwt';
import { newResourceId } from '@crewstation/kernel';
import type { ReleaseId } from '@crewstation/contracts';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { Hono } from 'hono';
import type { IdentityModule } from '../wiring';
import { identityMigrations } from '../wiring';
import { BASE_SETTINGS, completeBootstrap, identityModuleFor, loginWithPassword, mountRouters, seedLocalUser } from './identityFixture';

const available = await testDatabaseAvailable();
const workloads: Record<string, WorkloadIdentity> = {
  '10.244.0.23': { identity: 'demo/demo', project: 'demo', service: 'demo', kind: 'service', slot: 'prod' },
  '10.244.0.40': { identity: 'demo/demo', project: 'demo', service: 'demo', kind: 'dev-session' },
};
const testers = new Set<string>();
/** `<userId>@<slug>` → 正式地址被拦下时负责人是否允许申请；不在表里即放行。slug `gone` 模拟查不到项目。 */
const denied = new Map<string, boolean>();
const DEMO_PROJECT = '01a0bf5d-8f4b-7000-8000-00000000d3e0' as ProjectId;
let tdb: TestDatabase;
let identity: IdentityModule;
let app: Hono<AppEnv>;
let aliceCookie: string;
let aliceId: UserId;

function moduleOn(db: TestDatabase['db']): IdentityModule {
  return identityModuleFor(db, {
    settings: BASE_SETTINGS,
    previewAccess: { canView: async (userId, slug) => testers.has(`${userId}@${slug}`) },
    appAccess: {
      check: async (user, slug) => {
        if (slug === 'gone') return { kind: 'unknown' };
        const requestable = denied.get(`${user.id}@${slug}`);
        return requestable === undefined ? { kind: 'allowed' } : { kind: 'denied', projectId: DEMO_PROJECT, appName: '演示应用', ownerName: '王五', requestable };
      },
    },
    workloadLookup: { byIp: async (ip) => workloads[ip] },
    allowlistEvaluator: {
      externalWebhook: async (target) => target.host === 'producer.svc.cs.internal' && target.method === 'POST' && target.path === '/hooks/github' ? { kind: 'webhook' } : undefined,
      evaluate: async (caller, target) => {
        if (target.host === 'api.svc.cs.internal') return { allowed: true, targetIdentity: 'platform-api' };
        if (target.host === 'other.svc.cs.internal' && target.method === 'GET') return { allowed: true, targetIdentity: 'other/other' };
        return { allowed: false, reason: `${caller.identity} 未被放行调用 ${target.method} ${target.host}${target.path}`, targetIdentity: 'other/other' };
      },
    },
  });
}

function mount(module: IdentityModule): Hono<AppEnv> {
  return mountRouters(module, ['auth', 'forwardAuth']);
}

/** 播种一个本地账户再走真实的密码登录；本地账户是本 RFC 里唯一不依赖外部 IdP 的会话来源。 */
async function login(username: string, name?: string): Promise<{ cookie: string; userId: UserId }> {
  await seedLocalUser(tdb.db, { username, ...(name === undefined ? {} : { name }), email: `${username}@demo.invalid` });
  return loginWithPassword(app, identity, username);
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
  await completeBootstrap(tdb.db);
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

  test('正式地址按应用可见范围拦下：浏览器得到「没有项目权限」页（允许申请给申请入口，否则写负责人），程序调用 JSON，会话不清', async () => {
    const { cookie, userId } = await login('bob');
    denied.set(`${userId}@demo`, true);
    const html = await forwardUser('demo.cs.localhost', { cookie: `cs_session=${cookie}`, accept: 'text/html,application/xhtml+xml' });
    expect(html.status).toBe(403); expect(html.headers.get('content-type') ?? '').toContain('text/html');
    expect(html.headers.get('set-cookie')).toBeNull();
    expect(html.headers.get(IDENTITY_HEADERS.userId)).toBeNull();
    const page = await html.text();
    expect(page).toContain('没有项目权限'); expect(page).toContain('你没有应用「演示应用」的使用权限');
    expect(page).toContain(`href="http://console.cs.localhost/apps/${DEMO_PROJECT}/access" target="_blank" rel="noopener">申请访问权限</a>`);
    const json = await forwardUser('demo.cs.localhost', { cookie: `cs_session=${cookie}`, accept: 'application/json' });
    expect(json.status).toBe(403);
    expect(await json.json()).toEqual({ error: 'forbidden', message: '没有应用「演示应用」的使用权限', details: { reason: 'app-access', projectId: DEMO_PROJECT, requestable: true } });
    denied.set(`${userId}@demo`, false);
    const closed = await (await forwardUser('demo.cs.localhost', { cookie: `cs_session=${cookie}`, accept: 'text/html' })).text();
    expect(closed).toContain('请联系项目负责人：<strong>王五</strong>'); expect(closed).not.toContain('申请访问权限');
    // 待命版与开发预览的规则不变：仍是原来的 403 页，没有申请入口。
    const preview = await (await forwardUser('preview.demo.cs.localhost', { cookie: `cs_session=${cookie}`, accept: 'text/html' })).text();
    expect(preview).toContain('没有项目 demo 的 preview 访问权限'); expect(preview).not.toContain('申请访问权限');
    const gone = await forwardUser('gone.cs.localhost', { cookie: `cs_session=${cookie}`, accept: 'application/json' });
    expect(gone.status).toBe(403); expect(await gone.json()).toMatchObject({ error: 'forbidden', message: '未知的应用 gone' });
    denied.delete(`${userId}@demo`);
    expect((await forwardUser('demo.cs.localhost', { cookie: `cs_session=${cookie}` })).status).toBe(200);
  });

  test('非 ASCII 显示名：头按 RFC 8187 编码，令牌保留原文', async () => {
    const { cookie } = await login('zhang', '张三');
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
  test('开发对象 JWT 绑定任务、Pod 和当前索引，拒绝错误受众及 IP 复用', async () => {
    const ip = '10.244.35.2', taskId = newResourceId() as TaskId;
    const original: WorkloadIdentity & { developmentSource: NonNullable<WorkloadIdentity['developmentSource']> } = {
      identity: 'demo/demo', project: 'demo', service: 'demo', kind: 'dev-session', taskId,
      developmentSource: { podUid: 'dev-original', podName: 'dev-current', ip, taskId, ready: true },
    };
    workloads[ip] = original;
    try {
      const request = { 'x-forwarded-for': ip, 'x-forwarded-host': 'api.svc.cs.internal' };
      const response = await forwardService(request), token = response.headers.get(IDENTITY_HEADERS.sourceToken)!;
      expect(response.status).toBe(200);
      expect(await identity.api.resolveDevelopmentSource(token)).toEqual(original);
      expect(await identity.api.resolveServiceSource(token)).toBeUndefined();
      expect(await identity.api.resolveDevelopmentSource('forged')).toBeUndefined();
      const wrongAudience = await forwardService({ ...request, 'x-forwarded-host': 'other.svc.cs.internal' });
      expect(await identity.api.resolveDevelopmentSource(wrongAudience.headers.get(IDENTITY_HEADERS.sourceToken)!)).toBeUndefined();
      for (const patch of [{ podUid: 'new-pod' }, { taskId: newResourceId() as TaskId }, { ip: '10.244.35.3' }]) {
        workloads[ip] = { ...original, developmentSource: { ...original.developmentSource, ...patch } };
        expect(await identity.api.resolveDevelopmentSource(token)).toBeUndefined();
      }
      workloads[ip] = { ...original, identity: 'other/other', project: 'other' };
      expect(await identity.api.resolveDevelopmentSource(token)).toBeUndefined();
      workloads[ip] = { ...original, developmentSource: { ...original.developmentSource, ready: false } };
      expect(await identity.api.resolveDevelopmentSource(token)).toHaveProperty('developmentSource.ready', false);
      delete workloads[ip];
      expect(await identity.api.resolveDevelopmentSource(token)).toBeUndefined();
    } finally { delete workloads[ip]; }
  });

  test('对象传输端口仍按 DNS 主机鉴权，未知来源和伪造后缀不能获得平台受众', async () => {
    const headers = { 'x-forwarded-for': '10.244.0.23', 'x-forwarded-host': 'api.svc.cs.internal:8088', 'x-forwarded-uri': '/v3/objects/space' };
    const res = await forwardService(headers); expect(res.status).toBe(200);
    const token = await verifyWithJwks(res.headers.get(IDENTITY_HEADERS.sourceToken)!, await identity.api.jwks(), { audience: 'platform-api' });
    expect(token.subject).toBe('service:demo/demo');
    expect((await forwardService({ ...headers, 'x-forwarded-for': '10.244.0.250' })).status).toBe(403);
    expect((await forwardService({ ...headers, 'x-forwarded-host': 'api.svc.cs.internal.evil:8088' })).status).toBe(403);
  });
  test('RFC-027：签名绑定 release／Pod UID；过期来源、IP 复用、错误受众不能恢复执行身份', async () => {
    const ip = '10.244.27.9';
    const original: WorkloadIdentity & { source: NonNullable<WorkloadIdentity['source']> } = { identity: 'demo/demo', project: 'demo', service: 'demo', kind: 'service', slot: 'prod',
      source: { ip, podUid: 'original-pod', releaseId: newResourceId() as ReleaseId, physicalSlot: 'blue', ready: true } };
    workloads[ip] = original;
    try {
      const response = await forwardService({ 'x-forwarded-for': ip, 'x-forwarded-host': 'api.svc.cs.internal' });
      expect(response.status).toBe(200);
      const token = response.headers.get(IDENTITY_HEADERS.sourceToken)!;
      expect(await identity.api.resolveServiceSource(token)).toEqual(original);
      const verified = await verifyWithJwks(token, await identity.api.jwks(), { audience: 'platform-api', issuer: TOKEN_CLAIMS.issuer });
      expect(verified.claims).toMatchObject({ [TOKEN_CLAIMS.sourcePodUid]: 'original-pod', [TOKEN_CLAIMS.sourceReleaseId]: original.source!.releaseId, [TOKEN_CLAIMS.sourcePhysicalSlot]: 'blue' });
      const wrongAudience = await forwardService({ 'x-forwarded-for': ip, 'x-forwarded-host': 'other.svc.cs.internal' });
      expect(await identity.api.resolveServiceSource(wrongAudience.headers.get(IDENTITY_HEADERS.sourceToken)!)).toBeUndefined();
      expect(await identity.api.resolveServiceSource('forged')).toBeUndefined();
      for (const patch of [{ podUid: 'replaced' }, { releaseId: newResourceId() as ReleaseId }, { physicalSlot: 'green' as const }, { ip: '10.244.27.10' }]) {
        workloads[ip] = { ...original, source: { ...original.source!, ...patch } };
        expect(await identity.api.resolveServiceSource(token)).toBeUndefined();
      }
      workloads[ip] = { ...original, identity: 'other/other', project: 'other', service: 'other' };
      expect(await identity.api.resolveServiceSource(token)).toBeUndefined();
      // ready 与在线角色现查，不沿用旧令牌中签发时的运行状态。
      workloads[ip] = { ...original, slot: 'preview', source: { ...original.source!, ready: false } };
      expect(await identity.api.resolveServiceSource(token)).toMatchObject({ slot: 'preview', source: { ready: false } });
      delete workloads[ip];
      expect(await identity.api.resolveServiceSource(token)).toBeUndefined();
      const legacy = await forwardService({ 'x-forwarded-for': '10.244.0.23', 'x-forwarded-host': 'api.svc.cs.internal' });
      expect(await identity.api.resolveServiceSource(legacy.headers.get(IDENTITY_HEADERS.sourceToken)!)).toBeUndefined();
    } finally { delete workloads[ip]; }
  });

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
    const { cookie } = await loginWithPassword(app, identity, 'alice');
    const verified = await verifyWithJwks(cookie, await identity.api.jwks(), { audience: 'session' });
    expect(verified.kid).toBe(kid);
    // 另一副本尚未感知轮换：遇到未知 kid 时重读密钥环后验签成功。
    expect((await second.api.resolveSession(cookie))?.id).toBe(aliceId);
    expect((await second.api.jwks()).keys.length).toBe(2);
  });
});

describe.skipIf(!available)('external signed webhook boundary', () => {
  test('unknown workload reaches only the declared POST handler and never receives a platform identity', async () => {
    const headers = { 'x-forwarded-host': 'producer.svc.cs.internal', 'x-forwarded-for': '192.0.2.8', 'x-forwarded-method': 'POST', 'x-forwarded-uri': '/hooks/github?delivery=1' };
    const response = await forwardService({ ...headers, 'x-cs-source-service': 'platform/events', 'x-cs-source-token': 'forged' });
    expect(response.status).toBe(200);
    expect(response.headers.get(IDENTITY_HEADERS.traceId)).toMatch(/^[0-9a-f]{32}$/);
    for (const key of [IDENTITY_HEADERS.sourceService, IDENTITY_HEADERS.sourceToken, IDENTITY_HEADERS.sourceSlot, IDENTITY_HEADERS.userId, IDENTITY_HEADERS.identityToken]) expect(response.headers.get(key)).toBeNull();
    for (const change of [{ 'x-forwarded-method': 'GET' }, { 'x-forwarded-uri': '/hooks/github/extra' }, { 'x-forwarded-uri': '/v1/events/produce' }, { 'x-forwarded-host': 'api.svc.cs.internal' }]) expect((await forwardService({ ...headers, ...change })).status).toBe(403);
  });
});
