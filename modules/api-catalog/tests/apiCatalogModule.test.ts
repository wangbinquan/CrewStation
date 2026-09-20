import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Actor, Manifest, ProjectId, ReleaseId, ServiceId, UserId } from '@crewstation/contracts';
import { DomainTopic, IDENTITY_HEADERS, ManifestSchema } from '@crewstation/contracts';
import { eventbusMigrations, publishDomainEvent } from '@crewstation/eventbus';
import { createApp } from '@crewstation/http';
import { newId } from '@crewstation/kernel';
import { createIdentityModule, identityMigrations } from '@crewstation/module-identity';
import type { ProjectModule } from '@crewstation/module-project';
import { createProjectModule, projectMigrations } from '@crewstation/module-project';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { ApiCatalogModule } from '../wiring';
import { apiCatalogMigrations, createApiCatalogModule } from '../wiring';

const available = await testDatabaseAvailable();
let tdb: TestDatabase;
let project: ProjectModule;
let catalog: ApiCatalogModule;
let admin: Actor;
let owner: Actor;
let dev: Actor;
let issuesProject: { projectId: ProjectId; serviceId: ServiceId };
let demo: { projectId: ProjectId; serviceId: ServiceId };
let workerB: { projectId: ProjectId; serviceId: ServiceId };

const hosts = { prodHost: (s: string) => `${s}.cs.localhost`, previewHost: (s: string) => `preview.${s}.cs.localhost`, serviceHost: (s: string) => `${s}.svc.cs.internal` };
const service = { command: ['bun', 'run', 'src/main.ts'], port: 3000, plan: 'standard-small' };

const issuesDoc = {
  openapi: '3.0.3',
  info: { title: 'Issues', version: '1' },
  paths: {
    '/v1/issues': { get: { summary: '列表', responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Issue' } } } } } }, post: { summary: '创建', 'x-cs-resource-note': '按项目' } },
    '/v1/issues/{id}': { get: { summary: '详情', responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Issue' } } } } } } },
  },
  components: { schemas: { Issue: { type: 'object' }, Unused: { type: 'object' } } },
};
const issuesDocV2 = { ...issuesDoc, paths: { '/v1/issues': issuesDoc.paths['/v1/issues'] } };
const workerDoc = { openapi: '3.0.3', info: { title: 'Worker B', version: '1' }, paths: { '/reports': { get: { summary: '报告' } } } };

const issuesManifest: Manifest = ManifestSchema.parse({ apiVersion: 'crewstation/v1', kind: 'APIProxy', spec: { service, proxy: 'issues', upstream: { connection: 'gitlab-main' }, apis: { exposes: { openapi: './openapi.yaml' } } } });
const workerManifest = (exposes: boolean): Manifest => ManifestSchema.parse({ apiVersion: 'crewstation/v1', kind: 'DigitalWorker', spec: { service, apis: exposes ? { exposes: { openapi: './openapi.yaml' } } : {} } });

/** 发布登记事件并让消费者跑一轮；runOnce 会一并消费游标之后的所有事件（含 project.created、grant-changed），所以只断言效果。 */
async function registerRelease(target: { projectId: ProjectId; serviceId: ServiceId }, manifest: Manifest, openapiDocument?: unknown): Promise<void> {
  await publishDomainEvent(tdb.db, DomainTopic.releaseRegistered, {
    occurredAt: new Date().toISOString(), projectId: target.projectId, serviceId: target.serviceId, releaseId: newId('rel') as ReleaseId,
    tag: 'v1.0.0', commitSha: 'a'.repeat(40), manifest, ...(openapiDocument === undefined ? {} : { openapiDocument }),
  });
  await catalog.subscriptions[0]!.runOnce();
}

async function grantChangedEvents(): Promise<Array<[string, string]>> {
  const rows = (await tdb.db.execute(`SELECT payload->>'operationKey' AS operation_key, payload->>'state' AS state FROM platform_infra.domain_events WHERE topic = 'api-catalog.grant-changed' ORDER BY id`)) as unknown as Array<{ operation_key: string; state: string }>;
  return rows.map((r) => [r.operation_key, r.state]);
}

beforeAll(async () => {
  if (!available) return;
  tdb = await createTestDatabase([eventbusMigrations, identityMigrations, projectMigrations, apiCatalogMigrations]);
  const identity = createIdentityModule({ db: tdb.db, settings: { adminEmails: [] } });
  const a = await identity.api.ensureUser({ externalId: 'demo:admin', name: 'Admin', email: 'admin@example.com' });
    if (a.platformRole === 'user') await identity.api.setPlatformRole(a.id, { platformRole: 'developer', expectedRole: 'user' });
  const o = await identity.api.ensureUser({ externalId: 'demo:owner', name: 'Owner', email: 'owner@example.com' });
    if (o.platformRole === 'user') await identity.api.setPlatformRole(o.id, { platformRole: 'developer', expectedRole: 'user' });
  const d = await identity.api.ensureUser({ externalId: 'demo:dev', name: 'Dev', email: 'dev@example.com' });
    if (d.platformRole === 'user') await identity.api.setPlatformRole(d.id, { platformRole: 'developer', expectedRole: 'user' });
  admin = { userId: a.id, isAdmin: true };
  owner = { userId: o.id, isAdmin: false };
  dev = { userId: d.id, isAdmin: false };
  project = createProjectModule({ db: tdb.db, identity: identity.api, hosts, settings: { defaultMaxConcurrentTasks: 3, defaultServicePlan: 'standard-small' } });
  await project.api.upsertServicePlan(admin, { name: 'standard-small', cpu: '500m', memory: '512Mi', maxReplicas: 3, description: '' });
  const create = async (slug: string, kind: 'DigitalWorker' | 'APIProxy') => {
    const dto = await project.api.createProject(admin, { slug, name: slug, kind, ownerUserId: owner.userId, template: 'minimal-sample' });
    return { projectId: dto.id, serviceId: dto.serviceId! };
  };
  issuesProject = await create('issues', 'APIProxy');
  demo = await create('demo', 'DigitalWorker');
  workerB = await create('worker-b', 'DigitalWorker');
  await project.api.setMember(owner, demo.projectId, { userId: dev.userId, role: 'developer' });
  catalog = createApiCatalogModule({
    db: tdb.db,
    projects: project.api,
    users: { displayName: async (id) => id === dev.userId ? '开发者小李' : id === admin.userId ? '管理员老王' : undefined },
    services: {
      resolveService: async (serviceId) => {
        const s = await project.api.getService(admin, serviceId).catch(() => undefined);
        return s ? { projectId: s.projectId, serviceId: s.id, slug: s.name, identity: s.identity } : undefined;
      },
      resolveServiceIdentity: async (identity) => {
        const r = await project.api.resolveServiceIdentity(identity);
        return r ? { projectId: r.projectId, serviceId: r.serviceId, slug: r.slug, identity } : undefined;
      },
    },
    hosts: { platformApiHost: () => 'api.svc.cs.internal' },
  });
});
afterAll(async () => { await tdb?.drop(); });

describe.skipIf(!available)('api-catalog module', () => {
  const detailKey = 'issues:GET:/v1/issues/{id}';
  const listKey = 'issues:GET:/v1/issues';
  const createKey = 'issues:POST:/v1/issues';
  let requestId: string;

  test('release.registered：接入容器按 spec.proxy 登记操作（默认 targeted），数字人 exposes 以 slug 为代理名', async () => {
    await registerRelease(issuesProject, issuesManifest, issuesDoc);
    await registerRelease(workerB, workerManifest(true), workerDoc);
    const ops = await catalog.api.listOperations(dev);
    expect(ops.map((o) => o.key)).toEqual([listKey, detailKey, createKey, 'worker-b:GET:/reports']);
    expect(ops.every((o) => o.openPolicy === 'targeted' && o.granted === undefined)).toBe(true);
    expect(ops.find((o) => o.key === createKey)).toMatchObject({ summary: '创建', resourceNote: '按项目' });
    const proxies = await catalog.api.listProxies(dev);
    expect(proxies).toHaveLength(2);
    expect(proxies.find((p) => p.proxy === 'issues')).toMatchObject({ kind: 'APIProxy', upstreamConnection: 'gitlab-main', state: 'active', operationCount: 3, serviceId: issuesProject.serviceId });
    expect(proxies.find((p) => p.proxy === 'worker-b')).toMatchObject({ kind: 'DigitalWorker', state: 'active', operationCount: 1 });
    // OpenAPI 文档以 jsonb 对象存储（不是再编码一次的 JSON 字符串），SQL 侧可直接取字段
    const stored = (await tdb.db.execute(`SELECT proxy, jsonb_typeof(document) AS kind, document->'info'->>'title' AS title FROM api_catalog.proxies ORDER BY proxy`)) as unknown as Array<{ proxy: string; kind: string; title: string }>;
    expect(stored).toEqual([{ proxy: 'issues', kind: 'object', title: 'Issues' }, { proxy: 'worker-b', kind: 'object', title: 'Worker B' }]);
    // 重放同一事件是幂等的
    await registerRelease(issuesProject, issuesManifest, issuesDoc);
    expect((await catalog.api.listOperations(dev)).length).toBe(4);
  });

  test('setOpenPolicy 只有管理员；listOperations 对服务标注 granted，默认开放视为已授权', async () => {
    await expect(catalog.api.setOpenPolicy(dev, listKey, 'default')).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(catalog.api.setOpenPolicy(admin, 'issues:GET:/nope', 'default')).rejects.toMatchObject({ kind: 'not_found' });
    expect((await catalog.api.setOpenPolicy(admin, listKey, 'default')).openPolicy).toBe('default');
    const ops = await catalog.api.listOperations(dev, demo.serviceId);
    expect(ops.map((o) => [o.key, o.granted])).toEqual([[listKey, true], [detailKey, false], [createKey, false], ['worker-b:GET:/reports', false]]);
    await expect(catalog.api.listOperations(dev, workerB.serviceId)).rejects.toMatchObject({ kind: 'not_found' });
    await expect(catalog.api.listOperations(dev, 'svc_00000000000000000000000000000000' as ServiceId)).rejects.toMatchObject({ kind: 'not_found' });
  });

  test('申请 → 审批 → Grant 与 grant-changed 事件；重复申请、默认开放、非成员被拒', async () => {
    const stranger: Actor = { userId: 'usr_00000000000000000000000000000000' as UserId, isAdmin: false };
    await expect(catalog.api.requestAccess(stranger, demo.serviceId, { operationKey: detailKey })).rejects.toMatchObject({ kind: 'not_found' });
    await expect(catalog.api.requestAccess(dev, demo.serviceId, { operationKey: listKey })).rejects.toMatchObject({ kind: 'precondition' });
    const request = await catalog.api.requestAccess(dev, demo.serviceId, { operationKey: detailKey, reason: '同步工单' });
    requestId = request.id;
    expect(request).toMatchObject({ state: 'pending', serviceId: demo.serviceId, operationKey: detailKey, reason: '同步工单', requestedBy: dev.userId });
    await expect(catalog.api.requestAccess(dev, demo.serviceId, { operationKey: detailKey })).rejects.toMatchObject({ kind: 'conflict' });
    const listed = await catalog.api.listRequests(owner, demo.projectId);
    expect(listed.map((r) => r.id)).toEqual([requestId]);
    expect(listed[0]).toMatchObject({ requestedByName: '开发者小李' }); expect(listed[0]?.decidedByName).toBeUndefined();
    await expect(catalog.api.listRequests(dev)).rejects.toMatchObject({ kind: 'forbidden' });
    expect((await catalog.api.listRequests(admin)).length).toBe(1);
    await expect(catalog.api.decideRequest(dev, requestId, { approve: true })).rejects.toMatchObject({ kind: 'forbidden' });
    const decided = await catalog.api.decideRequest(admin, requestId, { approve: true, decision: '同意' });
    expect(decided).toMatchObject({ state: 'approved', decidedBy: admin.userId, decision: '同意' });
    expect(decided.decidedAt).toBeDefined();
    expect((await catalog.api.listRequests(admin))[0]).toMatchObject({ requestedByName: '开发者小李', decidedByName: '管理员老王' });
    await expect(catalog.api.decideRequest(admin, requestId, { approve: false })).rejects.toMatchObject({ kind: 'precondition' });
    await expect(catalog.api.requestAccess(dev, demo.serviceId, { operationKey: detailKey })).rejects.toMatchObject({ kind: 'conflict' });
    expect(await catalog.api.grantedOperations('demo/demo')).toEqual({ operations: [detailKey], defaultOpen: [listKey] });
    expect(await catalog.api.grantedOperations('nobody/nobody')).toEqual({ operations: [], defaultOpen: [listKey] });
    expect((await catalog.api.listOperations(dev, demo.serviceId)).find((o) => o.key === detailKey)?.granted).toBe(true);
    // 拒绝不产生 Grant
    const second = await catalog.api.requestAccess(dev, demo.serviceId, { operationKey: createKey });
    expect((await catalog.api.decideRequest(admin, second.id, { approve: false, decision: '写操作暂不开放' })).state).toBe('rejected');
    expect((await catalog.api.grantedOperations('demo/demo')).operations).toEqual([detailKey]);
    expect(await grantChangedEvents()).toEqual([[detailKey, 'granted']]);
  });

  test('prunedOpenApi：按服务可调范围裁剪、清理未引用组件、servers 指向服务域', async () => {
    const pruned = await catalog.api.prunedOpenApi(dev, demo.serviceId, 'issues');
    const paths = pruned.paths as Record<string, Record<string, unknown>>;
    expect(Object.keys(paths).sort()).toEqual(['/v1/issues', '/v1/issues/{id}']);
    expect(Object.keys(paths['/v1/issues']!)).toEqual(['get']);
    expect(Object.keys((pruned.components as { schemas: object }).schemas)).toEqual(['Issue']);
    expect(pruned.servers).toEqual([{ url: 'http://api.svc.cs.internal/api/issues' }]);
    await expect(catalog.api.prunedOpenApi(dev, demo.serviceId, 'nope')).rejects.toMatchObject({ kind: 'not_found' });
    await expect(catalog.api.prunedOpenApi(dev, workerB.serviceId, 'issues')).rejects.toMatchObject({ kind: 'not_found' });
  });

  test('撤销：Grant 记录保留但放行表不再包含；再撤销 not_found', async () => {
    await expect(catalog.api.revokeGrant(dev, demo.serviceId, detailKey)).rejects.toMatchObject({ kind: 'forbidden' });
    await catalog.api.revokeGrant(admin, demo.serviceId, detailKey);
    expect((await catalog.api.grantedOperations('demo/demo')).operations).toEqual([]);
    await expect(catalog.api.revokeGrant(admin, demo.serviceId, detailKey)).rejects.toMatchObject({ kind: 'not_found' });
    expect((await grantChangedEvents()).map(([, state]) => state)).toEqual(['granted', 'revoked']);
    // 撤销后可以再次申请并批准
    const again = await catalog.api.requestAccess(dev, demo.serviceId, { operationKey: detailKey });
    await catalog.api.decideRequest(admin, again.id, { approve: true });
    expect((await catalog.api.grantedOperations('demo/demo')).operations).toEqual([detailKey]);
  });

  test('新发布少了操作 → removed，Grant 保留但不再匹配；恢复后重新匹配且开放策略保留', async () => {
    await registerRelease(issuesProject, issuesManifest, issuesDocV2);
    expect((await catalog.api.listOperations(dev)).map((o) => o.key)).toEqual([listKey, createKey, 'worker-b:GET:/reports']);
    expect((await catalog.api.grantedOperations('demo/demo')).operations).toEqual([]);
    await expect(catalog.api.setOpenPolicy(admin, detailKey, 'default')).rejects.toMatchObject({ kind: 'not_found' });
    await registerRelease(issuesProject, issuesManifest, issuesDoc);
    expect((await catalog.api.grantedOperations('demo/demo'))).toEqual({ operations: [detailKey], defaultOpen: [listKey] });
    expect((await catalog.api.listOperations(dev)).find((o) => o.key === listKey)?.openPolicy).toBe('default');
  });

  test('数字人去掉 exposes → 代理与操作标记 removed；EventProducer 发布被忽略', async () => {
    await registerRelease(workerB, workerManifest(false));
    expect((await catalog.api.listProxies(dev)).find((p) => p.proxy === 'worker-b')).toMatchObject({ state: 'removed', operationCount: 0 });
    expect((await catalog.api.listOperations(dev)).some((o) => o.proxy === 'worker-b')).toBe(false);
    const producer: Manifest = ManifestSchema.parse({ apiVersion: 'crewstation/v1', kind: 'EventProducer', spec: { service, producer: 'gitlab', ingress: { path: '/hooks' }, produces: [{ eventType: 'gitlab.push' }] } });
    await registerRelease(workerB, producer);
    expect((await catalog.api.listProxies(dev)).length).toBe(2);
  });

  test('缺少 OpenAPI 文档的发布不会清空目录：处理器抛错，消费者不推进游标', async () => {
    const before = (await catalog.api.listOperations(dev)).length;
    await registerRelease(issuesProject, issuesManifest);
    expect((await catalog.api.listOperations(dev)).length).toBe(before);
    // 清理：让该事件在剩余重试内进入死信，避免阻塞后续测试的消费者
    for (let i = 0; i < 10; i += 1) await catalog.subscriptions[0]!.runOnce();
    const dead = (await tdb.db.execute(`SELECT consumer FROM platform_infra.event_dead_letters`)) as unknown as Array<{ consumer: string }>;
    expect(dead.map((d) => d.consumer)).toEqual(['api-catalog']);
  });

  test('HTTP 路由：URL 编码的操作键、查询参数、状态码与权限', async () => {
    const app = createApp({ name: 'test' });
    for (const router of catalog.http) app.route('/', router);
    const as = (actor: Actor, extra: Record<string, string> = {}) => ({ [IDENTITY_HEADERS.userId]: actor.userId, ...extra });
    const json = { 'content-type': 'application/json' };
    const encoded = encodeURIComponent(createKey);
    expect((await app.request('/v1/catalog/operations')).status).toBe(401);
    const list = await app.request(`/v1/catalog/operations?serviceId=${demo.serviceId}`, { headers: as(dev) });
    expect(list.status).toBe(200);
    expect(((await list.json()) as { items: Array<{ key: string; granted: boolean }> }).items.find((o) => o.key === listKey)?.granted).toBe(true);
    expect((await app.request('/v1/catalog/operations?serviceId=bad', { headers: as(dev) })).status).toBe(400);
    const policy = await app.request(`/v1/catalog/operations/${encoded}/policy`, { method: 'PUT', headers: as(admin, json), body: JSON.stringify({ openPolicy: 'default' }) });
    expect(policy.status).toBe(200);
    expect(await policy.json()).toMatchObject({ key: createKey, openPolicy: 'default' });
    expect((await app.request(`/v1/catalog/operations/${encoded}/policy`, { method: 'PUT', headers: as(dev, json), body: JSON.stringify({ openPolicy: 'targeted' }) })).status).toBe(403);
    const proxies = await app.request('/v1/catalog/proxies', { headers: as(dev) });
    expect(((await proxies.json()) as { items: unknown[] }).items.length).toBe(2);
    const openapi = await app.request(`/v1/catalog/proxies/issues/openapi?serviceId=${demo.serviceId}`, { headers: as(dev) });
    expect(openapi.status).toBe(200);
    expect(((await openapi.json()) as { servers: unknown }).servers).toEqual([{ url: 'http://api.svc.cs.internal/api/issues' }]);
    expect((await app.request('/v1/catalog/proxies/issues/openapi', { headers: as(dev) })).status).toBe(400);
    // 申请（先把 createKey 改回 targeted 以便申请）
    await catalog.api.setOpenPolicy(admin, createKey, 'targeted');
    const created = await app.request(`/v1/services/${demo.serviceId}/api-requests`, { method: 'POST', headers: as(dev, json), body: JSON.stringify({ operationKey: createKey, reason: '需要建单' }) });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { id: string; state: string };
    expect(createdBody.state).toBe('pending');
    const listed = await app.request(`/v1/api-requests?projectId=${demo.projectId}`, { headers: as(owner) });
    expect(((await listed.json()) as { items: Array<{ id: string }> }).items.some((r) => r.id === createdBody.id)).toBe(true);
    expect((await app.request('/v1/api-requests', { headers: as(dev) })).status).toBe(403);
    const decision = await app.request(`/v1/api-requests/${createdBody.id}/decision`, { method: 'POST', headers: as(admin, json), body: JSON.stringify({ approve: true }) });
    expect(decision.status).toBe(200);
    expect((await catalog.api.grantedOperations('demo/demo')).operations).toEqual([detailKey, createKey]);
    expect((await app.request(`/v1/services/${demo.serviceId}/grants/${encoded}`, { method: 'DELETE', headers: as(admin) })).status).toBe(204);
    expect((await app.request(`/v1/services/${demo.serviceId}/grants/${encoded}`, { method: 'DELETE', headers: as(admin) })).status).toBe(404);
    expect((await catalog.api.grantedOperations('demo/demo')).operations).toEqual([detailKey]);
  });
});
