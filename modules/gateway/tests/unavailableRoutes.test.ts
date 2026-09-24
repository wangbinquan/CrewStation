import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { ProjectId, ServiceId } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { createApp } from '@crewstation/http';
import { createFakeK8sClient } from '@crewstation/k8s';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { NotDeployedEntry } from '../index';
import { UNAVAILABLE_PATH } from '../index';
import type { LedgerRecordRead } from '../ports/ledger';
import { createGatewayModule, gatewayMigrations } from '../wiring';

// RFC-025 设计 §7.2、D13、I26 裁定：说明页挂在 cs-api 上（经调和器改指的路由到达）；浏览器给页面，接口给 503＋not-deployed，一律不缓存。
const available = await testDatabaseAvailable();
const serviceId = '01a0bf5d-8f4b-76c5-866c-f1feda3d63bb' as ServiceId;
const routeId = '01a0d005-cabc-7000-b909-8463b44eda44', slotId = '01a0d005-cabc-7000-b909-8463b44eda45';
const since = '2026-09-24T01:00:00.000Z';
const demo = { serviceId, projectId: '01a0bf5d-8f4b-7b10-9a12-5e7d8c4b3a66' as ProjectId, projectSlug: 'demo', serviceName: 'demo', namespace: 'cs-demo', identity: 'demo/demo', kind: 'DigitalWorker' as const, archived: false };
const records = new Map<string, LedgerRecordRead>([
  [routeId, { id: routeId, kind: 'route', owner: { module: 'gateway', ref: `${serviceId}/preview` }, desired: 'present', phase: 'ready', spec: { host: 'preview.demo.cs.localhost', target: { namespace: 'cs-demo', service: 'demo-green', port: 80 } }, display: { role: 'preview' }, conditions: [] }],
  [slotId, { id: slotId, kind: 'service-slot', owner: { module: 'release', ref: `${serviceId}/green` }, desired: 'present', phase: 'stopped', spec: {}, display: { tag: 'v0.1.2' }, conditions: [{ type: 'Serving', status: 'false', reason: 'offline-idle', since }] }],
]);
const pages: NotDeployedEntry[] = [];
let tdb: TestDatabase;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  if (!available) return;
  tdb = await createTestDatabase([eventbusMigrations, gatewayMigrations]);
  const gateway = createGatewayModule({
    db: tdb.db, k8s: createFakeK8sClient(),
    services: { listServices: async () => [demo], getService: async (id) => (id === serviceId ? demo : undefined), serviceIdOfProject: async () => serviceId },
    slots: { slotRoles: async () => ({ prod: 'blue', preview: 'green' }), notePreviewAccess: async () => {} },
    access: { authorize: async () => 'admin', isMemberOrAdmin: async () => true },
    users: { describe: async () => undefined },
    grants: { grantedOperations: async () => ({ operations: [], defaultOpen: [], operationRoutes: [] }), listCallers: async () => [], proxyNameOf: async () => undefined },
    hosts: { prodHost: (s) => `${s}.cs.localhost`, previewHost: (s) => `preview.${s}.cs.localhost`, serviceHost: (s) => `${s}.svc.cs.internal`, platformApiHost: () => 'api.svc.cs.internal' },
    isAdmin: async () => true,
    settings: { systemNamespace: 'crewstation-system', serviceDomain: 'svc.cs.internal', userAuthMiddleware: 'forward-auth-user', serviceAuthMiddleware: 'forward-auth-service', dropIdentityHeadersMiddleware: 'drop-identity-headers', allowlistMaxStaleSeconds: 300, consumerName: 'test.gateway-unavailable' },
    explainer: {
      reader: { get: async (id) => records.get(id), claimOf: async (child) => (child.kind === 'Service' && child.name === 'demo-green' ? slotId : undefined) },
      page: (entry, context) => { pages.push(entry); return `<html>说明页 ${entry.projectSlug} ${context.scheme ?? ''}</html>`; },
    },
  });
  app = createApp({ name: 'gateway-unavailable-test' });
  for (const router of gateway.http) app.route('/', router);
});
afterAll(async () => { await tdb?.drop(); });

describe.skipIf(!available)('说明页（RFC-025 D13）', () => {
  const ask = (accept: string, host = 'preview.demo.cs.localhost', method = 'GET') => app.request(`${UNAVAILABLE_PATH}/${routeId}`, { method, headers: { host, accept, 'x-forwarded-proto': 'https' } });

  test('浏览器得到页面（503，不缓存），内容按台账：项目、下线的原因、时间与版本', async () => {
    const page = await ask('text/html,application/xhtml+xml');
    expect(page.status).toBe(503);
    expect(page.headers.get('cache-control')).toBe('no-store');
    expect(page.headers.get('retry-after')).toBeNull();
    expect(await page.text()).toBe('<html>说明页 demo https</html>');
    expect(pages.at(-1)).toEqual({ kind: 'not-deployed', projectSlug: 'demo', slot: 'preview', offline: { at: since, reason: 'idle', tag: 'v0.1.2' } });
  });

  test('接口请求（任何方法）得到 503＋not-deployed 与下线记录；别的主机、不存在的路由 404', async () => {
    const json = await ask('application/json', 'preview.demo.cs.localhost', 'POST');
    expect(json.status).toBe(503);
    expect(await json.json()).toEqual({ error: 'not-deployed', message: 'demo 当前没有待验证版本', details: { at: since, reason: 'idle', tag: 'v0.1.2' } });
    expect((await ask('application/json', 'api.svc.cs.internal')).status).toBe(404);
    expect((await app.request(`${UNAVAILABLE_PATH}/01a0d005-cabc-7000-b909-8463b44eda46`, { headers: { host: 'preview.demo.cs.localhost' } })).status).toBe(404);
  });

  test('刚部署好、路由还没改回来：503 带 Retry-After，说「正在切换」', async () => {
    records.set(slotId, { ...records.get(slotId)!, phase: 'starting', conditions: [{ type: 'Serving', status: 'true', since }] });
    const json = await ask('application/json');
    expect(json.status).toBe(503);
    expect(json.headers.get('retry-after')).toBe('2');
    expect((await json.json() as { message: string }).message).toBe('demo 刚部署好新版本，正在切换，请稍后重试');
  });
});
