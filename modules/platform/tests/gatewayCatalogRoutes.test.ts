import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Actor, Manifest, ProjectId, ReleaseId, ServiceId, WorkloadIdentity } from '@crewstation/contracts';
import { DomainTopic, ManifestSchema } from '@crewstation/contracts';
import { publishDomainEvent } from '@crewstation/eventbus';
import { createFakeK8sClient } from '@crewstation/k8s';
import { newId, noopLogger } from '@crewstation/kernel';
import { runMigrations } from '@crewstation/persistence';
import { loadPlatformSettings } from '@crewstation/settings';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { PlatformModule } from '../wiring';
import { createPlatformModule } from '../wiring';

const available = await testDatabaseAvailable();
let tdb: TestDatabase;
let platform: PlatformModule;
let actor: Actor;
let target: { projectId: ProjectId; serviceId: ServiceId };
const k8s = createFakeK8sClient();
const service = { command: ['bun', 'src/main.ts'], port: 3000, servicePlanId: '01a0bf5d-8f4b-7000-9e4b-b54e91ee9d10' };
const document = { openapi: '3.0.3', info: { title: 'Proxy', version: '1' }, paths: { '/items': { get: {} } } };
const worker = (exposes: boolean): Manifest => ManifestSchema.parse({
  apiVersion: 'crewstation/v2', kind: 'DigitalWorker', spec: { service, apis: exposes ? { exposes: { openapi: './openapi.yaml' } } : {} },
});
const proxy: Manifest = ManifestSchema.parse({
  apiVersion: 'crewstation/v2', kind: 'APIProxy', spec: { service, proxy: 'test-gitlab', upstream: { connection: 'test-gitlab' }, apis: { exposes: { openapi: './openapi.yaml' } } },
});

beforeAll(async () => {
  if (!available) return;
  tdb = await createTestDatabase();
  const settings = loadPlatformSettings({
    CS_DATABASE_URL: tdb.url, CS_SECRET_KEY: Buffer.alloc(32, 1).toString('base64'),
    CS_ADMIN_EMAILS: 'routing@example.com', CS_GITLAB_URL: 'http://127.0.0.1:9',
  });
  platform = createPlatformModule({ db: tdb.db, k8s, settings, logger: noopLogger, instance: 'test.catalog-routes' });
  await runMigrations(tdb.db, platform.api.migrations);
  const user = await platform.modules.identity.api.ensureUser({ externalId: 'demo:routing', name: 'Routing', email: 'routing@example.com' });
  actor = { userId: user.id, isAdmin: true };
  await platform.modules.project.api.updateServicePlan(actor, '01a0bf5d-8f4b-7000-9e4b-b54e91ee9d10', { name: 'standard-small', cpu: '500m', memory: '512Mi', maxReplicas: 1, description: '' });
  const project = await platform.modules.project.api.createProject(actor, { slug: 'reference-proxy', name: 'Reference proxy', kind: 'APIProxy', ownerUserId: user.id, template: '01a0bf5d-8f4b-7002-9560-94caf593fb19' });
  target = { projectId: project.id, serviceId: project.serviceId! };
});
afterAll(async () => { await tdb?.drop(); });

async function publishRelease(manifest: Manifest) {
  await publishDomainEvent(tdb.db, DomainTopic.releaseRegistered, {
    occurredAt: new Date().toISOString(), ...target, releaseId: newId('rel') as ReleaseId,
    tag: 'v1.0.0', commitSha: 'a'.repeat(40), manifest, openapiDocument: document,
  });
}

async function register(manifest: Manifest) {
  await publishRelease(manifest);
  await platform.modules.apiCatalog.subscriptions[0]!.runOnce();
}

/**
 * 这个服务这一种路由眼下的记录（RFC-025 第三期后半：网关写路由记录，调和器照记录应用 IngressRoute；这里不起调和器，看期望）。
 * 摘掉又出现的顺延 `~2`，取还在用的那条。
 */
async function routeOf(serviceId: ServiceId, kind: string) {
  const records = await platform.modules.resources.api.list({ kind: 'route', includeStopped: true });
  return records.find((record) => record.owner.module === 'gateway' && record.desired === 'present' && (record.owner.ref === `${serviceId}/${kind}` || record.owner.ref.startsWith(`${serviceId}/${kind}~`)));
}
const internalPrefix = async () => (await routeOf(target.serviceId, 'internal-api'))?.spec['pathPrefix'];

describe.skipIf(!available)('平台装配的目录与网关路由', () => {
  test('退役的模板代理名不遮蔽当前 spec.proxy，路由与 OpenAPI 使用同一个名字', async () => {
    const { gateway, apiCatalog } = platform.modules;
    await register(worker(true));
    expect((await gateway.api.reconcileService(target.serviceId)).find((route) => route.kind === 'internal-api')?.pathPrefix).toBe('/api/reference-proxy');
    const before = (await apiCatalog.api.listProxies(actor))[0]!;
    await register(proxy);
    expect((await apiCatalog.api.listProxies(actor)).map((item) => [item.proxy, item.state])).toEqual([
      ['test-gitlab', 'active'],
    ]);
    expect((await apiCatalog.api.listProxies(actor))[0]!.id).toBe(before.id);
    const routes = await gateway.api.reconcileService(target.serviceId);
    // 真实试调的目录是 test-gitlab；旧组合根取排序在前的退役条目，实际网关只能匹配 reference-proxy。
    expect(routes.find((route) => route.kind === 'internal-api')).toMatchObject({
      host: 'api.svc.cs.internal', pathPrefix: '/api/test-gitlab',
      target: { service: 'reference-proxy-blue', namespace: 'cs-reference-proxy' },
    });
    expect((await apiCatalog.api.prunedOpenApi(actor, target.serviceId, before.id)).servers).toEqual([{ url: 'http://api.svc.cs.internal/api/test-gitlab' }]);
    // 内部 API 路由记录也认领它独用的前缀剥离中间件（RFC-025 T14）：名字跟着当前的代理名。
    expect((await routeOf(target.serviceId, 'internal-api'))?.spec).toMatchObject({ host: 'api.svc.cs.internal', pathPrefix: '/api/test-gitlab', children: [{ kind: 'IngressRoute', namespace: 'cs-reference-proxy', name: 'reference-proxy-internal-api' }, { kind: 'Middleware', namespace: 'cs-reference-proxy', name: 'strip-api-test-gitlab' }] });
  });

  test('当前服务撤下 exposes 后不再规划内部 API；未知服务也不借用其他服务的代理', async () => {
    await register(worker(false));
    const routes = await platform.modules.gateway.api.reconcileService(target.serviceId);
    expect(routes.map((route) => route.kind)).toEqual(['prod', 'preview', 'service']);
    // 内部 API 的路由记录标「不要了」（IngressRoute 由调和器删）。
    expect(await routeOf(target.serviceId, 'internal-api')).toBeUndefined();
    expect((await platform.modules.apiCatalog.api.listProxies(actor)).every((item) => item.state === 'removed')).toBe(true);
    expect(await platform.modules.gateway.api.reconcileService('01a0bf5d-8f4b-7430-8195-be2419fb2d35' as ServiceId)).toEqual([]);
  });

  test('网关先消费发布事件时，目录提交后仍会把实际路由更新为当前代理', async () => {
    const { gateway, apiCatalog } = platform.modules;
    await register(worker(true));
    await gateway.api.reconcileService(target.serviceId);
    await publishRelease(proxy);
    await gateway.subscriptions.runOnce();
    await apiCatalog.subscriptions[0]!.runOnce();
    expect((await apiCatalog.api.listProxies(actor)).find((item) => item.proxy === 'test-gitlab')?.state).toBe('active');
    // 两个消费者没有先后保证；目录落库前已推进的网关游标不会自动再处理同一事件。
    expect(await internalPrefix()).toBe('/api/test-gitlab');
  });

  test('目录更新后，较早开始而迟到的发布消费者不能把旧代理路由写回来', async () => {
    const { gateway, apiCatalog } = platform.modules;
    await register(worker(true));
    await gateway.subscriptions.runOnce();
    const apply = k8s.apply;
    let pause!: () => void;
    let resume!: () => void;
    const paused = new Promise<void>((resolve) => { pause = resolve; });
    const resumed = new Promise<void>((resolve) => { resume = resolve; });
    k8s.apply = async (object) => {
      if (object.metadata.name === 'reference-proxy-internal-api' && JSON.stringify(object.spec).includes('/api/reference-proxy')) {
        pause();
        await resumed;
      }
      return apply(object);
    };
    await publishRelease(proxy);
    const earlier = gateway.subscriptions.runOnce();
    try {
      // 两个消费者的游标行锁彼此独立；旧计划可能在目录提交后的新计划应用完才返回。
      await Promise.race([paused, earlier]);
      await apiCatalog.subscriptions[0]!.runOnce();
      resume();
      await earlier;
      expect(await internalPrefix()).toBe('/api/test-gitlab');
    } finally {
      resume();
      await earlier;
      k8s.apply = apply;
    }
  });

  /**
   * 放行表与路由都是「当前在册服务」的投影，而组合根原先把两件事都只接在别处：
   * - 建项目只重算路由，放行表要等某次无关的授权／目录变更才顺带把新服务带上，
   *   这中间新项目的开发容器连内置 MCP 都是 403「不能调用平台端点」（2026-09-22 本机实撞）；
   * - 归档先于事件落库，而 `serviceIdOfProject` 与 `getService` 都建在「在册服务」上，
   *   消费者跑到时这个服务已经查不到，`removeService` 直接返回，路由永远留在集群里继续对外服务。
   * 两条都只在真实组合根上才看得见：网关模块自己的用例用的是夹具目录。
   */
  test('建项目与归档项目：路由与放行表都跟着当前在册服务走', async () => {
    const { gateway, project } = platform.modules;
    await gateway.subscriptions.runOnce();
    // 先落一版不含新服务的放行表，免得下面第一发评估走「没有可用文档」的就地重建而顺手把它带上。
    await gateway.api.rebuildAllowlist();
    const created = await project.api.createProject(actor, { slug: 'newbie-worker', name: 'Newbie worker', kind: 'DigitalWorker', ownerUserId: actor.userId, template: '01a0bf5d-8f4b-7002-9560-94caf593fb19' });
    const devContainer: WorkloadIdentity = { identity: 'newbie-worker/newbie-worker', project: 'newbie-worker', service: 'newbie-worker', kind: 'dev-session' };
    const toMcp = () => gateway.api.evaluate(devContainer, { host: 'mcp-capabilities.svc.cs.internal', method: 'POST', path: '/mcp' });
    const serviceRoute = () => routeOf(created.serviceId!, 'service');
    expect((await toMcp()).reason).toBe('newbie-worker/newbie-worker 不能调用平台端点 mcp-capabilities.svc.cs.internal');

    expect(await gateway.subscriptions.runOnce()).toBe(1);
    expect((await toMcp()).allowed).toBe(true);
    expect(await serviceRoute()).toBeDefined();

    await project.api.setProjectState(created.id, 'active');
    await project.api.archiveProject(actor, created.id);
    expect(await gateway.subscriptions.runOnce()).toBe(1);
    expect(await serviceRoute()).toBeUndefined();
    expect((await toMcp()).allowed).toBe(false);
  });

  test('目录已提交而网关应用失败时，消费重试会修复路由且不重复登记操作', async () => {
    const { gateway, apiCatalog } = platform.modules;
    await register(worker(true));
    await gateway.subscriptions.runOnce();
    const apply = k8s.apply;
    let fail = true;
    // 网关自己还在建的是路由引用的前缀剥离中间件（IngressRoute 由调和器照记录应用）：让它失败一次。
    k8s.apply = async (object) => {
      if (fail && object.metadata.name === 'strip-api-test-gitlab') {
        fail = false;
        throw new Error('Kubernetes 暂时不可用');
      }
      return apply(object);
    };
    try {
      await publishRelease(proxy);
      expect(await apiCatalog.subscriptions[0]!.runOnce()).toBe(0);
      expect(await apiCatalog.api.activeProxyNameOf(target.serviceId)).toBe('test-gitlab');
      expect(await internalPrefix()).toBe('/api/reference-proxy');
      // 目录事务已经提交，派生路由失败不能推进事件游标；恢复后重放同一事件即可补齐。
      expect(await apiCatalog.subscriptions[0]!.runOnce()).toBe(1);
      expect(await internalPrefix()).toBe('/api/test-gitlab');
      expect((await apiCatalog.api.listOperations(actor)).map((item) => `${item.proxy}:${item.method}:${item.path}`)).toEqual(['test-gitlab:GET:/items']);
    } finally {
      k8s.apply = apply;
    }
  });
});
