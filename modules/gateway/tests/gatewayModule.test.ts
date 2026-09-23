import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { AllowlistDocument, ProjectId, ServiceId, WorkloadIdentity } from '@crewstation/contracts';
import { DomainTopic } from '@crewstation/contracts';
import { eventbusMigrations, publishDomainEvent } from '@crewstation/eventbus';
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
const newbieId = '01a0bf5d-8f4b-7b0e-9f0a-3c7d5e2a1b44' as ServiceId;
const newbieProjectId = '01a0bf5d-8f4b-7b0f-8e21-4d6c9f3b2a55' as ProjectId;
const services = [
  { serviceId: demoId, projectId: '01a0bf5d-8f4b-7b10-9a12-5e7d8c4b3a66' as ProjectId, projectSlug: 'demo', serviceName: 'demo', namespace: 'cs-demo', identity: 'demo/demo', kind: 'DigitalWorker' as const, archived: false },
  { serviceId: issuesId, projectId: '01a0bf5d-8f4b-7b11-b833-6f8e9d5c4b77' as ProjectId, projectSlug: 'issues', serviceName: 'issues', namespace: 'cs-issues', identity: 'issues/issues', kind: 'APIProxy' as const, archived: false },
];
const ingressRoutesOf = (namespace: string): string[] =>
  [...k8s.objects.values()].filter((o) => o.kind === 'IngressRoute' && o.metadata.namespace === namespace).map((o) => o.metadata.name).sort();
let prodPhysical: 'blue' | 'green' = 'blue';

/** 同一个库上的一个新模块实例＝一个刚启动的进程：自己的放行表缓存是空的。 */
function newGateway(extra: Partial<Pick<Parameters<typeof createGatewayModule>[0], 'ledger' | 'logger' | 'grants'>> = {}): GatewayModule {
  return createGatewayModule({
    db: tdb.db, k8s,
    // 两个取值范围与真实实现一致：清单只给在册服务，按 id／按项目的解析连归档的一起查得到。
    services: {
      listServices: async () => services.filter((s) => !s.archived),
      getService: async (id) => services.find((s) => s.serviceId === id),
      serviceIdOfProject: async (projectId) => services.find((s) => s.projectId === projectId)?.serviceId,
    },
    slots: { slotRoles: async () => ({ prod: prodPhysical, preview: prodPhysical === 'blue' ? 'green' : 'blue' }), standbyEntry: async () => ({ empty: false }), notePreviewAccess: async () => {} },
    access: { authorize: async () => 'admin', isMemberOrAdmin: async () => true },
    users: { describe: async () => undefined },
    grants: {
      grantedOperations: async (caller) => ({ operations: caller === 'demo/demo' ? ['01a0bf5d-8f4b-7155-8e96-d9844e02dfa4'] : [], defaultOpen: ['01a0bf5d-8f4b-73dc-813d-bb1eeb744398'], operationRoutes: [{ id: '01a0bf5d-8f4b-7155-8e96-d9844e02dfa4', proxy: 'issues', method: 'POST', path: '/v1/issues' }, { id: '01a0bf5d-8f4b-73dc-813d-bb1eeb744398', proxy: 'issues', method: 'GET', path: '/v1/issues/{id}' }] }),
      listCallers: async () => ['demo/demo'],
      proxyNameOf: async (id) => (id === issuesId ? 'issues' : undefined),
    },
    hosts: { prodHost: (s) => `${s}.cs.localhost`, previewHost: (s) => `preview.${s}.cs.localhost`, serviceHost: (s) => `${s}.svc.cs.internal`, platformApiHost: () => 'api.svc.cs.internal' },
    isAdmin: async () => true,
    settings: { systemNamespace: 'crewstation-system', serviceDomain: 'svc.cs.internal', userAuthMiddleware: 'forward-auth-user', serviceAuthMiddleware: 'forward-auth-service', dropIdentityHeadersMiddleware: 'drop-identity-headers', allowlistMaxStaleSeconds: 300, consumerName: 'test.gateway' },
    ...extra,
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
/** 新项目开发容器里的 Agent 连能力说明 MCP：正是本机撞到 403 的那一发。 */
const devContainer: WorkloadIdentity = { identity: 'newbie/newbie', project: 'newbie', service: 'newbie', kind: 'dev-session' };
const toMcp = () => gateway.api.evaluate(devContainer, { host: 'mcp-capabilities.svc.cs.internal', method: 'POST', path: '/mcp' });

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

  // 放行表是「当前已登记服务」的投影。建项目原先只重算路由，新服务根本不在表里，于是新项目的
  // 开发容器连内置 MCP 都是 403「不能调用平台端点」，要等某次无关的授权／目录变更才顺带带上
  // （2026-09-22 本机实撞：给一个未登记身份的 Pod 发 POST /mcp，网关回的就是这句）。
  test('建项目：路由与放行表一起重算，新项目的开发容器立刻连得上内置 MCP', async () => {
    const occurredAt = new Date().toISOString();
    services.push({ serviceId: newbieId, projectId: newbieProjectId, projectSlug: 'newbie', serviceName: 'newbie', namespace: 'cs-newbie', identity: 'newbie/newbie', kind: 'DigitalWorker', archived: false });
    expect((await toMcp()).reason).toBe('newbie/newbie 不能调用平台端点 mcp-capabilities.svc.cs.internal');

    await publishDomainEvent(tdb.db, DomainTopic.projectCreated, { occurredAt, projectId: newbieProjectId, slug: 'newbie', kind: 'DigitalWorker', namespace: 'cs-newbie' });
    expect(await gateway.subscriptions.runOnce()).toBe(1);
    expect((await toMcp()).allowed).toBe(true);
    expect(ingressRoutesOf('cs-newbie')).toEqual(['newbie-preview', 'newbie-prod', 'newbie-service']);
  });

  // 归档同样只做了一半：`serviceIdOfProject` 与 `getService` 都建在「在册服务」上，而归档先于事件落库，
  // 于是消费者跑到时这个服务已经查不到，`removeService` 直接返回——路由永远留在集群里继续对外服务。
  test('归档项目：路由真的被删掉，放行表条目也跟着消失', async () => {
    const newbie = services.find((s) => s.serviceId === newbieId)!;
    newbie.archived = true;
    await publishDomainEvent(tdb.db, DomainTopic.projectArchived, { occurredAt: new Date().toISOString(), projectId: newbieProjectId });
    expect(await gateway.subscriptions.runOnce()).toBe(1);
    expect(ingressRoutesOf('cs-newbie')).toEqual([]);
    expect((await toMcp()).allowed).toBe(false);
    // 解析范围放宽不等于让归档服务复活：再触发一次重算也不会把路由建回来。
    expect(await gateway.api.reconcileService(newbieId)).toEqual([]);
    expect(ingressRoutesOf('cs-newbie')).toEqual([]);
  });

  // 2026-09-23 RFC-021 实机撞见：管理员把操作改成默认开放后放行表没有重算，调用方一直 403「未对调用方开放」。
  test('开放策略变更：放行表立即重算', async () => {
    const before = (await gateway.api.currentAllowlist())?.version ?? 0;
    await publishDomainEvent(tdb.db, DomainTopic.openPolicyChanged, { occurredAt: new Date().toISOString(), operationId: '01a0bf5d-8f4b-73dc-813d-bb1eeb744398', openPolicy: 'default' });
    expect(await gateway.subscriptions.runOnce()).toBe(1);
    expect((await gateway.api.currentAllowlist())?.version).toBe(before + 1);
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

  // RFC-025 提案 Q5：墓碑保留 7 天。本机 09-11 以来 695 行里 666 行是从未清理的墓碑（audit §1.8）。
  test('身份索引墓碑：标为删除超过 7 天的行删掉，7 天之内的墓碑与在册的行不动', async () => {
    const { drizzlePodIdentityRepository } = await import('../adapters/persistence/drizzleRepositories');
    const { podIdentities } = await import('../adapters/persistence/tables');
    const repo = drizzlePodIdentityRepository(tdb.db);
    const day = 24 * 3_600_000, base = { namespace: 'cs-tomb', project: 'demo', service: 'demo', workload: 'service' as const, updatedAt: new Date() };
    for (const [podName, ip] of [['tomb-old', '10.244.9.1'], ['tomb-recent', '10.244.9.2'], ['alive', '10.244.9.3']] as const) await repo.upsert({ ...base, podName, ip });
    await repo.markDeleted('tomb-old', 'cs-tomb', new Date(Date.now() - 8 * day));
    await repo.markDeleted('tomb-recent', 'cs-tomb', new Date(Date.now() - day));
    expect(await gateway.api.purgeIdentityTombstones()).toBe(1);
    const left = (await tdb.db.select({ podName: podIdentities.podName, namespace: podIdentities.namespace }).from(podIdentities)).filter((row) => row.namespace === 'cs-tomb').map((row) => row.podName).sort();
    expect(left).toEqual(['alive', 'tomb-recent']);
    expect(await gateway.api.lookupByIp('10.244.9.3')).toMatchObject({ identity: 'demo/demo' });
    expect(await gateway.api.purgeIdentityTombstones()).toBe(0);
  });

  // 2026-09-23 本机：watch 断开期间被删的 Pod 收不到 DELETED，行一直在册（52 个 Pod、144 条在册行）；
  // IP 被业务 Pod 复用时反查取到死去的平台 Pod，把业务调用当成平台调用放行。
  test('全量重列：这次没列到的在册行标为删除，复用同一 IP 的新 Pod 反查到自己', async () => {
    const { drizzlePodIdentityRepository } = await import('../adapters/persistence/drizzleRepositories');
    const repo = drizzlePodIdentityRepository(tdb.db);
    await repo.upsert({ ip: '10.244.0.30', podName: 'mcp-capabilities-gone', namespace: 'crewstation-system', project: 'platform', service: 'mcp-capabilities', workload: 'platform', updatedAt: new Date(Date.now() - 3_600_000) });
    expect(await gateway.api.lookupByIp('10.244.0.30')).toMatchObject({ kind: 'platform' });
    const labels = { 'app.kubernetes.io/managed-by': 'crewstation', 'crewstation.io/project': 'demo', 'crewstation.io/service': 'demo', 'crewstation.io/workload': 'service', 'crewstation.io/slot': 'blue' };
    // 观测缓存第一次全量同步后交来的全部受管 Pod（RFC-025 设计 §7.4：身份索引由 cluster-control 的 Pod 观测驱动）。
    expect(await gateway.api.relistObservedPods([{ metadata: { name: 'demo-blue-new', namespace: 'cs-demo', labels }, status: { podIP: '10.244.0.30', phase: 'Running' } }])).toBeGreaterThanOrEqual(1);
    expect(await gateway.api.lookupByIp('10.244.0.30')).toMatchObject({ identity: 'demo/demo', kind: 'service' });
    expect((await repo.listActive()).map((p) => p.podName)).toEqual(['demo-blue-new']);
  });

  test('观测转交的 Pod：有 IP 即在册；删除中照旧在册（优雅退出期间 IP 仍是它的）；消失或已结束标删除；不带平台标签的不收', async () => {
    const labels = { 'app.kubernetes.io/managed-by': 'crewstation', 'crewstation.io/project': 'demo', 'crewstation.io/service': 'demo', 'crewstation.io/workload': 'service', 'crewstation.io/slot': 'green' };
    const pod = (ip: string, phase: string, deleting = false) => ({ metadata: { name: `demo-green-${ip.split('.').at(-1)}`, namespace: 'cs-demo', labels, ...(deleting ? { deletionTimestamp: '2026-09-24T01:00:00Z' } : {}) }, status: { podIP: ip, phase } });
    await gateway.api.syncObservedPod(pod('10.244.7.1', 'Running'), false);
    expect(await gateway.api.lookupByIp('10.244.7.1')).toMatchObject({ identity: 'demo/demo', kind: 'service' });
    await gateway.api.syncObservedPod(pod('10.244.7.1', 'Running', true), false);
    expect(await gateway.api.lookupByIp('10.244.7.1')).toMatchObject({ identity: 'demo/demo' });
    await gateway.api.syncObservedPod(pod('10.244.7.1', 'Running', true), true);
    expect(await gateway.api.lookupByIp('10.244.7.1')).toBeUndefined();
    await gateway.api.syncObservedPod(pod('10.244.7.2', 'Succeeded'), false);
    expect(await gateway.api.lookupByIp('10.244.7.2')).toBeUndefined();
    await gateway.api.syncObservedPod({ metadata: { name: 'stray', namespace: 'cs-demo' }, status: { podIP: '10.244.7.3', phase: 'Running' } }, false);
    expect(await gateway.api.lookupByIp('10.244.7.3')).toBeUndefined();
  });

  // RFC-025 第三期后半：服务的路由写成 route 记录，IngressRoute 由调和器照记录应用（gateway 只建前缀剥离中间件）；补投影按网关自己存的路由表；归档的标「不要了」。
  test('路由写进资源台账：每条一条记录、期望写全；配了台账不直接建 IngressRoute；补投影追上漏写的；归档的标「不要了」；台账写失败时重算报错、补投影只告警', async () => {
    type Spec = { readonly host?: string; readonly middlewares?: readonly { readonly name: string; readonly namespace?: string }[]; readonly priority?: number };
    const records = new Map<string, { id: string; desired: 'present' | 'absent'; spec: Spec; target: string }>(), releases: string[] = [], warnings: string[] = [];
    let failing = false;
    const ledger = {
      declare: async (input: { ref: string; spec: Spec; display: Readonly<Record<string, string>> }) => {
        if (failing) throw new Error('台账暂时不可用');
        const id = records.get(input.ref)?.id ?? `rec-${records.size + 1}`;
        records.set(input.ref, { id, desired: 'present', spec: input.spec, target: input.display['target'] ?? '' });
        return { id };
      },
      find: async (ref: string) => records.get(ref),
      requestRelease: async (id: string) => { releases.push(id); for (const [ref, record] of records) if (record.id === id) records.set(ref, { ...record, desired: 'absent' }); },
      report: async () => undefined,
    };
    const logger = { debug: () => undefined, info: () => undefined, warn: (msg: string) => { warnings.push(msg); }, error: () => undefined, child: () => logger };
    const withLedger = newGateway({ ledger, logger });
    const applied = k8s.applied.length;
    await withLedger.api.reconcileService(issuesId);
    // 路由之前先写了这个项目的限流记录（路由要引用它的中间件）。
    expect([...records.keys()].filter((ref) => ref.startsWith('project:'))).toEqual(['project:01a0bf5d-8f4b-7b11-b833-6f8e9d5c4b77']);
    expect([...records.entries()].filter(([ref]) => ref.startsWith(issuesId)).map(([ref, r]) => [ref.split('/')[1], r.spec.host, r.target]).sort()).toEqual([
      ['internal-api', 'api.svc.cs.internal', 'cs-issues/issues-green'], ['preview', 'preview.issues.cs.localhost', 'cs-issues/issues-blue'],
      ['prod', 'issues.cs.localhost', 'cs-issues/issues-green'], ['service', 'issues.svc.cs.internal', 'cs-issues/issues-green'],
    ]);
    expect(records.get(`${issuesId}/internal-api`)?.spec).toMatchObject({ priority: 100, middlewares: [
      { name: 'drop-identity-headers', namespace: 'crewstation-system' }, { name: 'forward-auth-service', namespace: 'crewstation-system' }, { name: 'strip-api-issues' },
    ] });
    // gateway 只建路由引用的前缀剥离中间件；IngressRoute 由调和器照记录应用。
    expect(k8s.applied.slice(applied).map((o) => `${o.kind}/${o.metadata.name}`)).toEqual(['Middleware/strip-api-issues']);
    // 补投影：台账接上之前就有的路由（这里清空假台账来模拟）照网关自己存的路由表声明，不碰集群。
    records.clear();
    const before = k8s.applied.length;
    expect(await withLedger.api.resyncRouteLedger()).toBeGreaterThanOrEqual(1);
    expect([...records.keys()].filter((ref) => ref.startsWith(issuesId))).toHaveLength(4);
    expect(k8s.applied.length).toBe(before);
    // 归档：记录标「不要了」（IngressRoute 由调和器删），gateway 不直接删。
    const deletedBefore = k8s.deleted.length;
    await withLedger.api.removeService(issuesId);
    expect([...records.entries()].filter(([ref]) => ref.startsWith(issuesId)).every(([, r]) => r.desired === 'absent')).toBe(true);
    expect(releases).toHaveLength(4);
    expect(k8s.deleted.length).toBe(deletedBefore);
    // 摘掉之后又出现（这里是同一服务再次计划路由）：已释放的记录不能重新声明，顺延到 ~2 各建一条新记录。
    await withLedger.api.reconcileService(issuesId);
    expect([...records.entries()].filter(([ref, r]) => ref.startsWith(issuesId) && r.desired === 'present').map(([ref]) => ref.split('/')[1]).sort())
      .toEqual(['internal-api~2', 'preview~2', 'prod~2', 'service~2']);
    await withLedger.api.reconcileService(issuesId);
    expect([...records.keys()].filter((ref) => ref.startsWith(issuesId))).toHaveLength(8);
    // 台账写失败：重算报错（事件会重投），补投影逐个服务告警、不中断。
    failing = true;
    await expect(withLedger.api.reconcileService(demoId)).rejects.toThrow('台账暂时不可用');
    // 归档服务的空计划不必写台账，照常算成功；其余的逐个告警。
    expect(await withLedger.api.resyncRouteLedger()).toBeLessThan((await withLedger.api.listRoutes()).length);
    expect(warnings).toContain('resource ledger route projection failed');
  });

  // RFC-025 设计 §7.4：放行表照旧由事件触发重算；定时全量核对兜住漏掉的事件，结果写进服务域路由记录的条件。
  test('放行表定时核对：一致时不重算、条件为假；授权变了而没触发重算时，重算一版并在有出入的服务的服务域路由上写真，下一轮恢复为假', async () => {
    const reports: Array<{ id: string; status: string; message?: string }> = [];
    const records = new Map<string, { id: string; desired: 'present' | 'absent' }>();
    const ledger = {
      declare: async (input: { ref: string }) => { const id = records.get(input.ref)?.id ?? `rec-${input.ref}`; records.set(input.ref, { id, desired: 'present' }); return { id }; },
      find: async (ref: string) => records.get(ref),
      requestRelease: async () => undefined,
      report: async (id: string, report: { conditions: readonly { status: string; message?: string }[] }) => { reports.push({ id, status: report.conditions[0]!.status, ...(report.conditions[0]!.message ? { message: report.conditions[0]!.message } : {}) }); },
    };
    const granted = new Map<string, string[]>([['demo/demo', ['01a0bf5d-8f4b-7155-8e96-d9844e02dfa4']]]);
    const grants = {
      grantedOperations: async (caller: string) => ({ operations: granted.get(caller) ?? [], defaultOpen: ['01a0bf5d-8f4b-73dc-813d-bb1eeb744398'], operationRoutes: [{ id: '01a0bf5d-8f4b-7155-8e96-d9844e02dfa4', proxy: 'issues', method: 'POST', path: '/v1/issues' }, { id: '01a0bf5d-8f4b-73dc-813d-bb1eeb744398', proxy: 'issues', method: 'GET', path: '/v1/issues/{id}' }] }),
      listCallers: async () => ['demo/demo'],
      proxyNameOf: async (id: ServiceId) => (id === issuesId ? 'issues' : undefined),
    } as unknown as Parameters<typeof createGatewayModule>[0]['grants'];
    const checked = newGateway({ ledger, grants });
    await checked.api.reconcileService(demoId);
    const demoRoute = records.get(`${demoId}/service`)!.id;
    const before = await checked.api.rebuildAllowlist();
    expect(await checked.api.checkAllowlist()).toEqual({ callers: [], global: false, version: before.version });
    expect(reports.filter((entry) => entry.id === demoRoute)).toEqual([{ id: demoRoute, status: 'false' }]);
    // demo 多了一项授权，但 grantChanged 事件丢了：放行表还是旧的。
    granted.set('demo/demo', ['01a0bf5d-8f4b-7155-8e96-d9844e02dfa4', '01a0bf5d-8f4b-73dc-813d-bb1eeb744398']);
    expect(await checked.api.checkAllowlist()).toEqual({ callers: ['demo/demo'], global: false, version: before.version + 1 });
    expect((await checked.api.currentAllowlist())?.entries.find((entry) => entry.caller === 'demo/demo')?.operations).toHaveLength(2);
    expect(reports.filter((entry) => entry.id === demoRoute).at(-1)).toEqual({ id: demoRoute, status: 'true', message: `定时核对发现放行表与当前授权不一致，已重算为第 ${before.version + 1} 版` });
    expect(await checked.api.checkAllowlist()).toMatchObject({ callers: [], global: false, version: before.version + 1 });
    expect(reports.filter((entry) => entry.id === demoRoute).at(-1)?.status).toBe('false');
    // 没配资源台账：照样核对与重算，只是不写条件。
    expect(await newGateway({ grants }).api.checkAllowlist()).toMatchObject({ callers: [], global: false });
  });
});
