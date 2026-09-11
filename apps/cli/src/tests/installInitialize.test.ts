import { describe, expect, test } from 'bun:test';
import { clusterOk, fakeCluster, jsonResponse, memoryFiles, routes, runForTest } from './cliHarness';

const yaml = (allowlist: string, integrations: string) => `
profile: kind-dev
namespace: crewstation-system
controlPlane: { replicas: 1 }
network:
  consoleHost: console.cs.localhost
  appsDomain: cs.localhost
  previewDomain: cs.localhost
  serviceDomain: svc.cs.internal
  sourceIpPreserved: true
sourceControl: { baseUrl: "http://127.0.0.1:8929", groupId: "1" }
integrations: ${integrations}
egress: { mode: proxy, allowlist: ${allowlist} }
`;

const BUNDLE_DIRS = ['/bundle', '/bundle/profiles'];
const PLANS = '- { name: standard-small, cpu: "500m", memory: 512Mi, maxReplicas: 3 }\n';
const PROFILES = '- { name: coding-medium, cpu: "1", memory: 2Gi, storage: 10Gi }\n';

const ADMIN = { id: `usr_${'a'.padEnd(32, '0')}`, name: '管理员', email: 'a@example.com', isAdmin: true, memberships: [], demoIdentity: true };
const CLUSTER = fakeCluster({ version: clusterOk('{}') });

function filesFor(allowlist: string, integrations = '{ gitlabEventProducer: { enabled: false }, referenceApiProxy: { enabled: false } }'): ReturnType<typeof memoryFiles> {
  return memoryFiles({
    '/install.yaml': yaml(allowlist, integrations),
    '/bundle/release.lock.yaml': 'version: 0.1.0\n',
    '/bundle/profiles/service-plans.yaml': PLANS,
    '/bundle/profiles/task-profiles.yaml': PROFILES,
  }, BUNDLE_DIRS);
}

async function initialize(files: ReturnType<typeof memoryFiles>, respond: ReturnType<typeof routes>): Promise<{ code: number; checks: { label: string; outcome: string; detail: string }[]; calls: readonly { method: string; url: string; body: unknown }[] }> {
  const result = await runForTest(['install', '--config', '/install.yaml', '--bundle', '/bundle', '--only', 'initialize', '--json'], {
    files, cluster: CLUSTER, respond,
  });
  const report = JSON.parse(result.out.join('\n')) as { phases: { checks: { label: string; outcome: string; detail: string }[] }[] };
  return { code: result.code, checks: report.phases[0]?.checks ?? [], calls: result.calls };
}

describe('安装第 5 步：能做的真做', () => {
  test('发行包里的套餐写进平台目录', async () => {
    const respond = routes({
      'PUT /v1/catalog/service-plans': jsonResponse(200, {}),
      'PUT /v1/catalog/task-profiles': jsonResponse(200, {}),
      'GET /v1/egress/entries': jsonResponse(200, { items: [] }),
      'POST /v1/egress/entries': jsonResponse(201, {}),
    });
    const { checks, calls } = await initialize(filesFor('[git.example.com]'), respond);
    expect(checks.find((check) => check.label.includes('服务套餐'))?.outcome).toBe('ok');
    expect(calls.filter((call) => call.url.includes('/catalog/'))).toHaveLength(2);
  });

  test('出站白名单里的占位符被筛掉并点名，结论是受限', async () => {
    const respond = routes({
      'PUT /v1/catalog/service-plans': jsonResponse(200, {}),
      'PUT /v1/catalog/task-profiles': jsonResponse(200, {}),
      'GET /v1/egress/entries': jsonResponse(200, { items: [{ id: 'e1', fqdn: 'git.example.com', scope: 'global', createdBy: ADMIN.id, createdAt: '2026-09-11T08:00:00.000Z' }] }),
      'POST /v1/egress/entries': jsonResponse(201, {}),
    });
    const { checks, calls } = await initialize(filesFor('["<model-endpoints>", git.example.com, registry.example.com]'), respond);
    const egress = checks.find((check) => check.label === '全局出站白名单');
    expect(egress?.outcome).toBe('limited');
    expect(egress?.detail).toContain('<model-endpoints>');
    expect(egress?.detail).toContain('已存在 1 条');
    const added = calls.filter((call) => call.method === 'POST' && call.url.endsWith('/v1/egress/entries'));
    expect(added).toHaveLength(1);
    expect(added[0]?.body).toMatchObject({ fqdn: 'registry.example.com', scope: 'global' });
  });

  test('启用的接入容器按管理员身份代建平台项目', async () => {
    const respond = routes({
      'PUT /v1/catalog/service-plans': jsonResponse(200, {}),
      'PUT /v1/catalog/task-profiles': jsonResponse(200, {}),
      'GET /v1/egress/entries': jsonResponse(200, { items: [] }),
      'POST /v1/egress/entries': jsonResponse(201, {}),
      'GET /v1/me': jsonResponse(200, ADMIN),
      'POST /v1/projects': jsonResponse(201, {}),
    });
    const files = filesFor('[git.example.com]', '{ gitlabEventProducer: { enabled: true }, referenceApiProxy: { enabled: true } }');
    const { checks, calls } = await initialize(files, respond);
    expect(checks.find((check) => check.label === '接入容器平台项目')?.outcome).toBe('ok');
    const created = calls.filter((call) => call.method === 'POST' && call.url.endsWith('/v1/projects'));
    expect(created.map((call) => (call.body as { slug: string }).slug)).toEqual(['gitlab-event-producer', 'reference-api-proxy']);
    expect(created[0]?.body).toMatchObject({ kind: 'EventProducer', template: 'gitlab-event-producer', ownerUserId: ADMIN.id });
    expect(created[1]?.body).toMatchObject({ kind: 'APIProxy', template: 'reference-api-proxy' });
  });

  test('项目已存在（409）按幂等处理，安装可以重跑', async () => {
    const respond = routes({
      'PUT /v1/catalog/service-plans': jsonResponse(200, {}),
      'PUT /v1/catalog/task-profiles': jsonResponse(200, {}),
      'GET /v1/egress/entries': jsonResponse(200, { items: [] }),
      'POST /v1/egress/entries': jsonResponse(201, {}),
      'GET /v1/me': jsonResponse(200, ADMIN),
      'POST /v1/projects': jsonResponse(409, { error: 'conflict', message: 'slug 已占用', details: {} }),
    });
    const files = filesFor('[git.example.com]', '{ gitlabEventProducer: { enabled: true }, referenceApiProxy: { enabled: false } }');
    const { checks } = await initialize(files, respond);
    const projects = checks.find((check) => check.label === '接入容器平台项目');
    expect(projects?.outcome).toBe('ok');
    expect(projects?.detail).toContain('已存在');
  });

  test('令牌不是管理员时报待配置，而不是硬闯', async () => {
    const respond = routes({
      'PUT /v1/catalog/service-plans': jsonResponse(200, {}),
      'PUT /v1/catalog/task-profiles': jsonResponse(200, {}),
      'GET /v1/egress/entries': jsonResponse(200, { items: [] }),
      'POST /v1/egress/entries': jsonResponse(201, {}),
      'GET /v1/me': jsonResponse(200, { ...ADMIN, isAdmin: false }),
    });
    const files = filesFor('[git.example.com]', '{ gitlabEventProducer: { enabled: true }, referenceApiProxy: { enabled: false } }');
    const { checks } = await initialize(files, respond);
    expect(checks.find((check) => check.label === '接入容器平台项目')?.outcome).toBe('pending-config');
  });

  test('平台 API 出错时这一步是失败，整体退出码 1', async () => {
    const respond = routes({ 'PUT /v1/catalog/service-plans': jsonResponse(500, { error: 'internal', message: '目录写入失败', details: {} }) });
    const { code, checks } = await initialize(filesFor('[git.example.com]'), respond);
    expect(code).toBe(1);
    expect(checks.find((check) => check.label.includes('服务套餐'))?.outcome).toBe('failed');
  });

  test('平台没有路由的几件事如实报未实现', async () => {
    const respond = routes({
      'PUT /v1/catalog/service-plans': jsonResponse(200, {}),
      'PUT /v1/catalog/task-profiles': jsonResponse(200, {}),
      'GET /v1/egress/entries': jsonResponse(200, { items: [] }),
      'POST /v1/egress/entries': jsonResponse(201, {}),
    });
    const { checks } = await initialize(filesFor('[git.example.com]'), respond);
    const notImplemented = checks.filter((check) => check.outcome === 'not-implemented').map((check) => check.label);
    expect(notImplemented).toContain('最小样例模板');
    expect(notImplemented).toContain('源码托管连接、上游连接与开放策略');
  });
});
