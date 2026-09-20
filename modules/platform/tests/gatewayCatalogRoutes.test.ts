import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Actor, Manifest, ProjectId, ReleaseId, ServiceId } from '@crewstation/contracts';
import { DomainTopic, ManifestSchema } from '@crewstation/contracts';
import { publishDomainEvent } from '@crewstation/eventbus';
import { createFakeK8sClient, Resources } from '@crewstation/k8s';
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
    const ingress = k8s.applied.filter((item) => item.kind === 'IngressRoute' && item.metadata.name === 'reference-proxy-internal-api').at(-1)!;
    expect(ingress.spec).toMatchObject({ routes: [{ match: 'Host(`api.svc.cs.internal`) && PathPrefix(`/api/test-gitlab`)' }] });
  });

  test('当前服务撤下 exposes 后不再规划内部 API；未知服务也不借用其他服务的代理', async () => {
    await register(worker(false));
    const routes = await platform.modules.gateway.api.reconcileService(target.serviceId);
    expect(routes.map((route) => route.kind)).toEqual(['prod', 'preview', 'service']);
    expect(await k8s.get(Resources.IngressRoute!, 'reference-proxy-internal-api', 'cs-reference-proxy')).toBeUndefined();
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
    const ingress = await k8s.get(Resources.IngressRoute!, 'reference-proxy-internal-api', 'cs-reference-proxy');
    expect(ingress?.spec).toMatchObject({ routes: [{ match: 'Host(`api.svc.cs.internal`) && PathPrefix(`/api/test-gitlab`)' }] });
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
      const ingress = await k8s.get(Resources.IngressRoute!, 'reference-proxy-internal-api', 'cs-reference-proxy');
      expect(ingress?.spec).toMatchObject({ routes: [{ match: 'Host(`api.svc.cs.internal`) && PathPrefix(`/api/test-gitlab`)' }] });
    } finally {
      resume();
      await earlier;
      k8s.apply = apply;
    }
  });

  test('目录已提交而网关应用失败时，消费重试会修复路由且不重复登记操作', async () => {
    const { gateway, apiCatalog } = platform.modules;
    await register(worker(true));
    await gateway.subscriptions.runOnce();
    const apply = k8s.apply;
    let fail = true;
    k8s.apply = async (object) => {
      if (fail && object.metadata.name === 'reference-proxy-internal-api') {
        fail = false;
        throw new Error('Kubernetes 暂时不可用');
      }
      return apply(object);
    };
    try {
      await publishRelease(proxy);
      expect(await apiCatalog.subscriptions[0]!.runOnce()).toBe(0);
      expect(await apiCatalog.api.activeProxyNameOf(target.serviceId)).toBe('test-gitlab');
      const beforeRetry = await k8s.get(Resources.IngressRoute!, 'reference-proxy-internal-api', 'cs-reference-proxy');
      expect(beforeRetry?.spec).toMatchObject({ routes: [{ match: 'Host(`api.svc.cs.internal`) && PathPrefix(`/api/reference-proxy`)' }] });
      // 目录事务已经提交，派生路由失败不能推进事件游标；恢复后重放同一事件即可补齐。
      expect(await apiCatalog.subscriptions[0]!.runOnce()).toBe(1);
      const recovered = await k8s.get(Resources.IngressRoute!, 'reference-proxy-internal-api', 'cs-reference-proxy');
      expect(recovered?.spec).toMatchObject({ routes: [{ match: 'Host(`api.svc.cs.internal`) && PathPrefix(`/api/test-gitlab`)' }] });
      expect((await apiCatalog.api.listOperations(actor)).map((item) => `${item.proxy}:${item.method}:${item.path}`)).toEqual(['test-gitlab:GET:/items']);
    } finally {
      k8s.apply = apply;
    }
  });
});
