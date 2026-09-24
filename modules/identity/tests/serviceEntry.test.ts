import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { UserId, WorkloadIdentity } from '@crewstation/contracts';
import { IDENTITY_HEADERS } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { Hono } from 'hono';
import type { ServiceEntryVerdict } from '../ports/serviceEntry';
import { identityMigrations } from '../wiring';
import { BASE_SETTINGS, completeBootstrap, identityModuleFor, loginWithPassword, mountRouters, seedLocalUser } from './identityFixture';

const available = await testDatabaseAvailable();
let tdb: TestDatabase;
let app: Hono<AppEnv>;
let cookie: string;
let userId: UserId;
/** 每个用例改这里决定入口判定；测试者身份对 preview 有权限。 */
let verdict: ServiceEntryVerdict = { kind: 'open' };
const asked: Array<[string, string]> = [];
const caller: WorkloadIdentity = { identity: 'other/other', project: 'other', service: 'other', kind: 'service', slot: 'prod' };

beforeAll(async () => {
  if (!available) return;
  tdb = await createTestDatabase([identityMigrations]);
  const identity = identityModuleFor(tdb.db, {
    settings: BASE_SETTINGS,
    previewAccess: { canView: async () => true },
    // 使用权另有用例（forwardAuth.test.ts）；这里只看维护入口，一律放行。
    appAccess: { check: async () => ({ kind: 'allowed' }) },
    serviceEntry: { check: async (_user, slug, slot) => { asked.push([slug, slot]); return verdict; } },
    workloadLookup: { byIp: async (ip) => (ip === '10.244.0.50' ? caller : undefined) },
    allowlistEvaluator: { evaluate: async () => ({ allowed: false, targetIdentity: 'service:demo', reason: 'demo 的正式版本维护中：换库', unavailable: { message: 'demo 的正式版本维护中：换库', retryAfterSeconds: 120 } }) },
  });
  app = mountRouters(identity, ['auth', 'forwardAuth']);
  await completeBootstrap(tdb.db);
  await seedLocalUser(tdb.db, { username: 'visitor', email: 'visitor@demo.invalid' });
  ({ cookie, userId } = await loginWithPassword(app, identity, 'visitor'));
});
afterAll(async () => { await tdb?.drop(); });

const forward = (host: string, accept: string) => app.request('/forward-auth/user', { headers: { 'x-forwarded-proto': 'http', 'x-forwarded-host': host, 'x-forwarded-uri': '/', 'x-forwarded-method': 'GET', accept, cookie: `cs_session=${cookie}` } });

describe.skipIf(!available)('RFC-021 用户域入口：维护页与未部署页', () => {
  test('入口放行时照常 200 并注入身份；prod 与 preview 主机都会先问入口状态，dev 主机不问', async () => {
    verdict = { kind: 'open' }; asked.length = 0;
    const res = await forward('demo.cs.localhost', 'application/json');
    expect(res.status).toBe(200);
    expect(res.headers.get(IDENTITY_HEADERS.userId)).toBe(userId);
    expect((await forward('preview.demo.cs.localhost', 'application/json')).status).toBe(200);
    expect((await forward('dev.demo.cs.localhost', 'application/json')).status).toBe(200);
    expect(asked).toEqual([['demo', 'prod'], ['demo', 'preview']]);
  });

  test('正式版本维护中：浏览器得到带原因与预计恢复时间的维护页，接口得到 503 JSON 与 Retry-After；都不注入身份', async () => {
    verdict = { kind: 'maintenance', projectSlug: 'demo', reason: '迁移 <数据>', expectedEndAt: '2026-09-23T10:00:00.000Z', retryAfterSeconds: 600 };
    const page = await forward('demo.cs.localhost', 'text/html');
    expect(page.status).toBe(503);
    expect(page.headers.get('retry-after')).toBe('600');
    expect(page.headers.get(IDENTITY_HEADERS.userId)).toBeNull();
    const html = await page.text();
    expect(html).toContain('demo 正在维护');
    expect(html).toContain('迁移 &lt;数据&gt;');
    expect(html).toContain('datetime="2026-09-23T10:00:00.000Z"');
    const json = await forward('demo.cs.localhost', 'application/json');
    expect(json.status).toBe(503);
    expect(await json.json()).toEqual({ error: 'maintenance', message: 'demo 正在维护：迁移 <数据>', details: { reason: '迁移 <数据>', expectedEndAt: '2026-09-23T10:00:00.000Z' } });
  });


  test('服务域：目标正式版本维护中时 503 JSON 与 Retry-After，不签来源令牌', async () => {
    const res = await app.request('/forward-auth/service', { headers: { 'x-forwarded-proto': 'http', 'x-forwarded-method': 'GET', 'x-forwarded-uri': '/v1/things', 'x-forwarded-for': '10.244.0.50', 'x-forwarded-host': 'demo.svc.cs.internal' } });
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('120');
    expect(res.headers.get(IDENTITY_HEADERS.sourceToken)).toBeNull();
    expect(await res.json()).toEqual({ error: 'maintenance', message: 'demo 的正式版本维护中：换库', details: {} });
  });
});
