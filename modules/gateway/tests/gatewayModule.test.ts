import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { AllowlistDocument, ServiceId, WorkloadIdentity } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import type { FakeK8sClient } from '@crewstation/k8s';
import { createFakeK8sClient } from '@crewstation/k8s';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { GatewayModule } from '../wiring';
import { createGatewayModule, gatewayMigrations } from '../wiring';

const available = await testDatabaseAvailable();
let tdb: TestDatabase;
let k8s: FakeK8sClient;
let gateway: GatewayModule;
const demoId = '01a0bf5d-8f4b-76c5-866c-f1feda3d63bb' as ServiceId;
const issuesId = '01a0bf5d-8f4b-7549-872a-18d62f6a1f6d' as ServiceId;
const services = [
  { serviceId: demoId, projectSlug: 'demo', serviceName: 'demo', namespace: 'cs-demo', identity: 'demo/demo', kind: 'DigitalWorker' as const },
  { serviceId: issuesId, projectSlug: 'issues', serviceName: 'issues', namespace: 'cs-issues', identity: 'issues/issues', kind: 'APIProxy' as const },
];
let prodPhysical: 'blue' | 'green' = 'blue';

/** 同一个库上的一个新模块实例＝一个刚启动的进程：自己的放行表缓存是空的。 */
function newGateway(): GatewayModule {
  return createGatewayModule({
    db: tdb.db, k8s,
    services: { listServices: async () => services, getService: async (id) => services.find((s) => s.serviceId === id), serviceIdOfProject: async () => demoId },
    slots: { slotRoles: async () => ({ prod: prodPhysical, preview: prodPhysical === 'blue' ? 'green' : 'blue' }) },
    grants: {
      grantedOperations: async (caller) => ({ operations: caller === 'demo/demo' ? ['01a0bf5d-8f4b-7155-8e96-d9844e02dfa4'] : [], defaultOpen: ['01a0bf5d-8f4b-73dc-813d-bb1eeb744398'], operationRoutes: [{ id: '01a0bf5d-8f4b-7155-8e96-d9844e02dfa4', proxy: 'issues', method: 'POST', path: '/v1/issues' }, { id: '01a0bf5d-8f4b-73dc-813d-bb1eeb744398', proxy: 'issues', method: 'GET', path: '/v1/issues/{id}' }] }),
      listCallers: async () => ['demo/demo'],
      proxyNameOf: async (id) => (id === issuesId ? 'issues' : undefined),
    },
    hosts: { prodHost: (s) => `${s}.cs.localhost`, previewHost: (s) => `preview.${s}.cs.localhost`, serviceHost: (s) => `${s}.svc.cs.internal`, platformApiHost: () => 'api.svc.cs.internal' },
    isAdmin: async () => true,
    settings: { systemNamespace: 'crewstation-system', serviceDomain: 'svc.cs.internal', userAuthMiddleware: 'forward-auth-user', serviceAuthMiddleware: 'forward-auth-service', dropIdentityHeadersMiddleware: 'drop-identity-headers', allowlistMaxStaleSeconds: 300, consumerName: 'test.gateway' },
  });
}

beforeAll(async () => {
  if (!available) return;
  tdb = await createTestDatabase([eventbusMigrations, gatewayMigrations]);
  k8s = createFakeK8sClient();
  gateway = newGateway();
});
afterAll(async () => { await tdb?.drop(); });

const caller: WorkloadIdentity = { identity: 'demo/demo', project: 'demo', service: 'demo', kind: 'service', slot: 'prod' };

describe.skipIf(!available)('gateway module', () => {
  test('路由生成：用户域两主机、服务域主机、内部 API 前缀；切流后重算指向', async () => {
    const routes = await gateway.api.reconcileService(issuesId);
    expect(routes.map((r) => [r.kind, r.host, r.target.service])).toEqual([
      ['prod', 'issues.cs.localhost', 'issues-blue'], ['preview', 'preview.issues.cs.localhost', 'issues-green'],
      ['service', 'issues.svc.cs.internal', 'issues-blue'], ['internal-api', 'api.svc.cs.internal', 'issues-blue'],
    ]);
    const ingressRoutes = k8s.applied.filter((o) => o.kind === 'IngressRoute');
    expect(ingressRoutes.map((o) => o.metadata.name).sort()).toEqual(['issues-internal-api', 'issues-preview', 'issues-prod', 'issues-service']);
    const internal = ingressRoutes.find((o) => o.metadata.name === 'issues-internal-api')!;
    const rule = (internal.spec as { routes: Array<{ match: string; middlewares: Array<{ name: string; namespace?: string }> }> }).routes[0]!;
    expect(rule.match).toBe('Host(`api.svc.cs.internal`) && PathPrefix(`/api/issues`)');
    expect(rule.middlewares).toEqual([{ name: 'drop-identity-headers', namespace: 'crewstation-system' }, { name: 'forward-auth-service', namespace: 'crewstation-system' }, { name: 'strip-api-issues' }]);
    expect(k8s.applied.some((o) => o.kind === 'Middleware' && o.metadata.name === 'strip-api-issues')).toBe(true);
    prodPhysical = 'green';
    const switched = await gateway.api.reconcileService(issuesId);
    expect(switched.find((r) => r.kind === 'prod')?.target.service).toBe('issues-green');
    expect((await gateway.api.listRoutes()).length).toBe(1);
  });

  test('放行表：默认开放、定向授权、平台 API、未知调用方、未知主机', async () => {
    const doc = await gateway.api.rebuildAllowlist();
    expect(doc.version).toBe(1);
    expect(doc.entries.find((e) => e.caller === 'demo/demo')?.operations).toEqual(['01a0bf5d-8f4b-7155-8e96-d9844e02dfa4']);
    const at = (method: string, path: string, host = 'api.svc.cs.internal') => gateway.api.evaluate(caller, { host, method, path });
    expect((await at('GET', '/api/issues/v1/issues/42?x=1')).allowed).toBe(true);
    expect((await at('POST', '/api/issues/v1/issues')).allowed).toBe(true);
    expect((await at('DELETE', '/api/issues/v1/issues/42')).allowed).toBe(false);
    expect((await at('POST', '/v1/business-tasks')).allowed).toBe(true);
    expect((await at('GET', '/v1/issues/42', 'issues.svc.cs.internal')).allowed).toBe(true);
    expect((await gateway.api.evaluate({ ...caller, identity: 'ghost/ghost' }, { host: 'api.svc.cs.internal', method: 'POST', path: '/v1/business-tasks' })).allowed).toBe(false);
    expect((await at('GET', '/', 'evil.example.com')).allowed).toBe(false);

    // 平台端点不按操作键判定：没人会去登记 `mcp-operations:POST:/mcp` 这种键。
    expect((await at('POST', '/mcp', 'mcp-capabilities.svc.cs.internal')).allowed).toBe(true);
    expect((await at('POST', '/mcp', 'mcp-operations.svc.cs.internal')).allowed).toBe(true);
    // 事件入口只对 EventProducer 开放：DigitalWorker 不能凭空造事件。
    const produce = await at('POST', '/v1/events/produce', 'events.svc.cs.internal');
    expect(produce.allowed).toBe(false);
    expect(produce.reason).toContain('平台端点');
    // 未登记的调用方连 MCP 也到不了。
    expect((await gateway.api.evaluate({ ...caller, identity: 'ghost/ghost' }, { host: 'mcp-operations.svc.cs.internal', method: 'POST', path: '/mcp' })).allowed).toBe(false);

    // 平台自身的工作负载（cs-events 投递事件）不在放行表里，按操作键判定必然被拒。
    const platformCaller = { ...caller, identity: 'crewstation/cs-events', kind: 'platform' as const };
    expect((await gateway.api.evaluate(platformCaller, { host: 'demo.svc.cs.internal', method: 'POST', path: '/events/gitlab' })).allowed).toBe(true);
    // 同一个主机换成未登记的数字人调用方仍然被拒。
    expect((await gateway.api.evaluate({ ...caller, identity: 'ghost/ghost' }, { host: 'demo.svc.cs.internal', method: 'POST', path: '/events/gitlab' })).allowed).toBe(false);

    expect((await gateway.api.rebuildAllowlist()).version).toBe(2);
  });

  // 锁的真实故障（2026-09-21 本机实撞）：RFC-013 把放行表的 identityVersion 升到 2，升级后库里最新一份仍是旧格式；
  // 读取侧把它当作不存在，而重建只由授权／目录变更或手动「重算」触发——没人触发，服务域调用于是全部 403「放行表尚未生成」。
  test('升级后库里最新一份是旧身份版本的放行表：首个服务域请求就地重建，而不是一直被拒', async () => {
    const { allowlists } = await import('../adapters/persistence/tables');
    // 形状取自本机升级前的真实文档：没有 identityVersion 与 operationRoutes，默认开放项还是操作键而不是资源 ID。
    const legacy = { version: 40, generatedAt: '2026-09-20T12:53:55.831Z', defaultOpen: ['issues:GET:/v1/issues/{id}'], maxStaleSeconds: 300, entries: [{ caller: 'demo/demo', operations: [], platformApi: true, platformHosts: ['platformApi', 'mcpCapabilities', 'mcpOperations'] }] };
    await tdb.db.insert(allowlists).values({ version: legacy.version, document: legacy as unknown as AllowlistDocument, generatedAt: new Date(legacy.generatedAt) });
    // 管理页的读取是纯读取：旧文档照实报告为「没有可用的放行表」，不因为有人打开页面就写库。
    const [first, second] = [newGateway(), newGateway()];
    expect(await first.api.currentAllowlist()).toBeUndefined();
    // 升级＝新进程：cs-auth 与 cs-api 都装配了 gateway，各自没有缓存，同时迎来第一批服务域请求。
    const verdicts = await Promise.all([first, second, first].map((instance) => instance.api.evaluate(caller, { host: 'api.svc.cs.internal', method: 'POST', path: '/v1/business-tasks' })));
    expect(verdicts.map((verdict) => verdict.allowed)).toEqual([true, true, true]);
    expect(await first.api.currentAllowlist()).toMatchObject({ identityVersion: 2, version: 41 });
    expect((await second.api.currentAllowlist())?.version).toBe(41);
    // 两个进程抢着重建也只落一份新版本：抢输的一方改用赢家落库的那份，不把主键冲突漏给调用方。
    const versions = (await tdb.db.select({ version: allowlists.version }).from(allowlists)).map((row) => row.version).sort((a, b) => a - b);
    expect(versions).toEqual([1, 2, 40, 41]);
    // 旧文档里按操作键写的授权不会被沿用：重建后的判定来自当前的授权数据。
    expect((await first.api.evaluate(caller, { host: 'api.svc.cs.internal', method: 'DELETE', path: '/api/issues/v1/issues/42' })).allowed).toBe(false);
  });

  test('Pod 身份索引：按 IP 反查，物理槽映射为角色，删除后不可查', async () => {
    const { drizzlePodIdentityRepository } = await import('../adapters/persistence/drizzleRepositories');
    const repo = drizzlePodIdentityRepository(tdb.db);
    expect(await gateway.api.lookupByIp('10.244.0.9')).toBeUndefined();
    await repo.upsert({ ip: '10.244.0.9', podName: 'demo-green-abc', namespace: 'cs-demo', project: 'demo', service: 'demo', workload: 'service', physicalSlot: 'green', updatedAt: new Date() });
    expect(await gateway.api.lookupByIp('10.244.0.9')).toMatchObject({ identity: 'demo/demo', kind: 'service', slot: 'prod' });
    const again = await repo.upsert({ ip: '10.244.0.10', podName: 'demo-green-abc', namespace: 'cs-demo', project: 'demo', service: 'demo', workload: 'service', physicalSlot: 'green', updatedAt: new Date() });
    expect(again.version).toBe(2);
    expect(await gateway.api.lookupByIp('10.244.0.9')).toBeUndefined();
    await repo.markDeleted('demo-green-abc', 'cs-demo', new Date());
    expect(await gateway.api.lookupByIp('10.244.0.10')).toBeUndefined();
  });
});
