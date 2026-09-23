import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Actor, ProjectId, ServiceId, UserId } from '@crewstation/contracts';
import { IDENTITY_HEADERS, ProjectRateLimitsDtoSchema, RateLimitSettingsDtoSchema } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { createApp } from '@crewstation/http';
import { createFakeK8sClient } from '@crewstation/k8s';
import { isPlatformError } from '@crewstation/kernel';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { DEFAULT_RATE_LIMITS } from '../domain/rateLimits';
import type { GatewayModule } from '../wiring';
import { createGatewayModule, gatewayMigrations } from '../wiring';

const available = await testDatabaseAvailable();
let tdb: TestDatabase;
let gateway: GatewayModule;

const demoId = '01a0bf5d-8f4b-76c5-866c-f1feda3d6311' as ServiceId;
const demoProject = '01a0bf5d-8f4b-7b10-9a12-5e7d8c4b3a13' as ProjectId, archivedProject = '01a0bf5d-8f4b-7b10-9a12-5e7d8c4b3a14' as ProjectId;
const services = [{ serviceId: demoId, projectId: demoProject, projectSlug: 'demo', serviceName: 'demo', namespace: 'cs-demo', identity: 'demo/demo', kind: 'DigitalWorker' as const, archived: false }];
const admin: Actor = { userId: '01a0bf5d-8f4b-7210-80c1-302ae945b021' as UserId, isAdmin: true }, developer: Actor = { userId: '01a0bf5d-8f4b-7210-80c1-302ae945b022' as UserId, isAdmin: false };

async function rejected(promise: Promise<unknown>): Promise<string> {
  try { await promise; } catch (error) { if (isPlatformError(error)) return error.kind; throw error; }
  throw new Error('expected rejection');
}

beforeAll(async () => {
  if (!available) return;
  tdb = await createTestDatabase([eventbusMigrations, gatewayMigrations]);
  gateway = createGatewayModule({
    db: tdb.db, k8s: createFakeK8sClient(),
    services: { listServices: async () => services, getService: async (id) => services.find((s) => s.serviceId === id), serviceIdOfProject: async (p) => services.find((s) => s.projectId === p)?.serviceId },
    slots: { slotRoles: async () => ({ prod: 'blue', preview: 'green' }), standbyEntry: async () => ({ empty: false }), notePreviewAccess: async () => {} },
    grants: { grantedOperations: async () => ({ operations: [], defaultOpen: [], operationRoutes: [] }), listCallers: async () => [], proxyNameOf: async () => undefined },
    hosts: { prodHost: (s) => `${s}.cs.localhost`, previewHost: (s) => `preview.${s}.cs.localhost`, serviceHost: (s) => `${s}.svc.cs.internal`, platformApiHost: () => 'api.svc.cs.internal' },
    access: { authorize: async () => 'admin', isMemberOrAdmin: async () => true },
    users: { describe: async () => undefined },
    isAdmin: async (id) => id === admin.userId,
    settings: { systemNamespace: 'crewstation-system', serviceDomain: 'svc.cs.internal', userAuthMiddleware: 'forward-auth-user', serviceAuthMiddleware: 'forward-auth-service', dropIdentityHeadersMiddleware: 'drop-identity-headers', allowlistMaxStaleSeconds: 300, consumerName: 'test.rate-limits' },
  });
});
afterAll(async () => { await tdb?.drop(); });

describe.skipIf(!available)('网关限流策略（RFC-025 设计 §7.3、T10）', () => {
  test('平台默认：没人改过时是内置默认、版本 0；改了版本加一；拿旧版本号再改是 409；非管理员读写都是 403', async () => {
    expect(RateLimitSettingsDtoSchema.parse(await gateway.api.getRateLimits(admin))).toEqual({ ...DEFAULT_RATE_LIMITS, revision: 0, updatedAt: null });
    const tighter = { ...DEFAULT_RATE_LIMITS, platformApi: { perUser: { average: 10, burst: 20 }, inFlightPerUser: 8 } };
    const saved = await gateway.api.setRateLimits(admin, { ...tighter, expectedRevision: 0 });
    expect(saved).toMatchObject({ platformApi: { inFlightPerUser: 8 }, revision: 1, updatedBy: admin.userId });
    expect(await gateway.api.getRateLimits(admin)).toMatchObject({ platformApi: { perUser: { average: 10 } }, revision: 1 });
    expect(await rejected(gateway.api.setRateLimits(admin, { ...DEFAULT_RATE_LIMITS, expectedRevision: 0 }))).toBe('conflict');
    expect(await rejected(gateway.api.getRateLimits(developer))).toBe('forbidden');
    expect(await rejected(gateway.api.setRateLimits(developer, { ...DEFAULT_RATE_LIMITS, expectedRevision: 1 }))).toBe('forbidden');
  });

  test('项目覆盖：没有时生效值照平台默认；设了只换那一项；撤掉回到平台默认；旧版本号 409；不存在或已归档的项目 404', async () => {
    const platform = await gateway.api.getRateLimits(admin);
    const initial = ProjectRateLimitsDtoSchema.parse(await gateway.api.getProjectRateLimits(admin, demoProject));
    expect(initial).toEqual({ projectId: demoProject, override: null, effective: { userDomain: platform.userDomain, serviceDomain: platform.serviceDomain }, revision: 0, updatedAt: null });
    const userDomain = { perUser: { average: 5, burst: 10 }, perHost: { average: 50, burst: 100 } };
    const set = await gateway.api.setProjectRateLimits(admin, demoProject, { override: { userDomain }, expectedRevision: 0 });
    expect(set).toMatchObject({ override: { userDomain }, effective: { userDomain, serviceDomain: platform.serviceDomain }, revision: 1 });
    expect(await gateway.api.effectiveRateLimits(demoProject)).toEqual({ userDomain, serviceDomain: platform.serviceDomain });
    expect(await rejected(gateway.api.setProjectRateLimits(admin, demoProject, { override: null, expectedRevision: 0 }))).toBe('conflict');
    const cleared = await gateway.api.setProjectRateLimits(admin, demoProject, { override: null, expectedRevision: 1 });
    expect(cleared).toMatchObject({ override: null, effective: { userDomain: platform.userDomain }, revision: 0 });
    // 没有覆盖时再撤一次：本来就没有，照常返回。
    expect((await gateway.api.setProjectRateLimits(admin, demoProject, { override: null, expectedRevision: 0 })).override).toBeNull();
    expect(await rejected(gateway.api.getProjectRateLimits(admin, archivedProject))).toBe('not_found');
    expect(await rejected(gateway.api.setProjectRateLimits(admin, archivedProject, { override: {}, expectedRevision: 0 }))).toBe('not_found');
    expect(await rejected(gateway.api.getProjectRateLimits(developer, demoProject))).toBe('forbidden');
  });

  test('HTTP：管理员读写平台默认与项目覆盖；非管理员 403；不合规的请求体 400', async () => {
    const app = createApp({ name: 'rate-limits-test' }); for (const r of gateway.http) app.route('/', r);
    const as = (actor: Actor) => ({ [IDENTITY_HEADERS.userId]: actor.userId, [IDENTITY_HEADERS.userName]: 'n', [IDENTITY_HEADERS.userEmail]: 'e@x', 'content-type': 'application/json' });
    const settings = await (await app.request('/v1/admin/settings/rate-limits', { headers: as(admin) })).json() as { revision: number };
    expect((await app.request('/v1/admin/settings/rate-limits', { headers: as(developer) })).status).toBe(403);
    expect((await app.request('/v1/admin/settings/rate-limits', { method: 'PUT', headers: as(admin), body: JSON.stringify({ ...DEFAULT_RATE_LIMITS, expectedRevision: settings.revision, extra: 1 }) })).status).toBe(400);
    const put = await app.request('/v1/admin/settings/rate-limits', { method: 'PUT', headers: as(admin), body: JSON.stringify({ ...DEFAULT_RATE_LIMITS, expectedRevision: settings.revision }) });
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ revision: settings.revision + 1 });
    const path = `/v1/admin/projects/${demoProject}/rate-limits`;
    expect((await app.request(path, { headers: as(admin) })).status).toBe(200);
    const override = await app.request(path, { method: 'PUT', headers: as(admin), body: JSON.stringify({ override: { serviceDomain: DEFAULT_RATE_LIMITS.serviceDomain }, expectedRevision: 0 }) });
    expect(await override.json()).toMatchObject({ override: { serviceDomain: DEFAULT_RATE_LIMITS.serviceDomain }, revision: 1 });
    expect((await app.request(path, { method: 'PUT', headers: as(developer), body: JSON.stringify({ override: null, expectedRevision: 1 }) })).status).toBe(403);
  });
});
