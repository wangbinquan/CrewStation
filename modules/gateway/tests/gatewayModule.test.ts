import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { ServiceId, WorkloadIdentity } from '@crewstation/contracts';
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
const demoId = 'svc_0123456789abcdef0123456789abcdef' as ServiceId;
const issuesId = 'svc_1123456789abcdef0123456789abcdef' as ServiceId;
const services = [
  { serviceId: demoId, projectSlug: 'demo', serviceName: 'demo', namespace: 'cs-demo', identity: 'demo/demo', kind: 'DigitalWorker' as const },
  { serviceId: issuesId, projectSlug: 'issues', serviceName: 'issues', namespace: 'cs-issues', identity: 'issues/issues', kind: 'APIProxy' as const },
];
let prodPhysical: 'blue' | 'green' = 'blue';

beforeAll(async () => {
  if (!available) return;
  tdb = await createTestDatabase([eventbusMigrations, gatewayMigrations]);
  k8s = createFakeK8sClient();
  gateway = createGatewayModule({
    db: tdb.db, k8s,
    services: { listServices: async () => services, getService: async (id) => services.find((s) => s.serviceId === id), serviceIdOfProject: async () => demoId },
    slots: { slotRoles: async () => ({ prod: prodPhysical, preview: prodPhysical === 'blue' ? 'green' : 'blue' }) },
    grants: {
      grantedOperations: async (caller) => ({ operations: caller === 'demo/demo' ? ['issues:POST:/v1/issues'] : [], defaultOpen: ['issues:GET:/v1/issues/{id}'] }),
      listCallers: async () => ['demo/demo'],
      proxyNameOf: async (id) => (id === issuesId ? 'issues' : undefined),
    },
    hosts: { prodHost: (s) => `${s}.cs.localhost`, previewHost: (s) => `preview.${s}.cs.localhost`, serviceHost: (s) => `${s}.svc.cs.internal`, platformApiHost: () => 'api.svc.cs.internal' },
    isAdmin: async () => true,
    settings: { systemNamespace: 'crewstation-system', serviceDomain: 'svc.cs.internal', userAuthMiddleware: 'forward-auth-user', serviceAuthMiddleware: 'forward-auth-service', dropIdentityHeadersMiddleware: 'drop-identity-headers', allowlistMaxStaleSeconds: 300, consumerName: 'test.gateway' },
  });
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
    expect(doc.entries.find((e) => e.caller === 'demo/demo')?.operations).toEqual(['issues:POST:/v1/issues']);
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
