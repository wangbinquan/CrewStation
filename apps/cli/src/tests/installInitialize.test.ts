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
const PLANS = '- { id: 01a0bf5d-8f4b-7000-9e4b-b54e91ee9d10, name: standard-small, cpu: "500m", memory: 512Mi, maxReplicas: 3 }\n';
const PROFILES = '- { id: 01a0bf5d-8f4b-7001-8458-107366e7de39, name: coding-medium, cpu: "1", memory: 2Gi, storage: 10Gi }\n';
/** 旧发行包里的档位文件（RFC-001 形状）：RFC-006 起安装器不再读取它。 */
const LEGACY_COMPUTE = '- { name: balanced, driver: claude-code, model: anthropic/claude-sonnet-5 }\n';

const ADMIN = { id: `usr_${'a'.padEnd(32, '0')}`, name: '管理员', email: 'a@example.com', platformRole: 'admin', isAdmin: true, memberships: [], authMethod: 'password' as const };
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
      'POST /v1/catalog/service-plans': jsonResponse(200, {}),
      'POST /v1/catalog/task-profiles': jsonResponse(200, {}),
    });
    const { checks, calls } = await initialize(filesFor('[git.example.com]'), respond);
    expect(checks.find((check) => check.label.includes('服务套餐'))?.outcome).toBe('ok');
    expect(checks.find((check) => check.label === '算力档位')).toMatchObject({ outcome: 'pending-config' });
    expect(calls.filter((call) => call.url.includes('/catalog/'))).toHaveLength(2);
  });

  /** RFC-018：旧 install.yaml 里的 egress 段被忽略——不报错、不出检查行、不发请求。 */
  test('旧配置里的出站白名单被忽略，初始化不再播种也不再报出站检查行', async () => {
    const respond = routes({
      'POST /v1/catalog/service-plans': jsonResponse(200, {}),
      'POST /v1/catalog/task-profiles': jsonResponse(200, {}),
    });
    const { checks, calls } = await initialize(filesFor('["<model-endpoints>", git.example.com, registry.example.com]'), respond);
    expect(checks.some((check) => check.label.includes('出站'))).toBe(false);
    expect(calls.some((call) => call.url.includes('egress'))).toBe(false);
    // 其余初始化照常完成，说明忽略的只是这一段。
    expect(checks.find((check) => check.label.includes('服务套餐'))?.outcome).toBe('ok');
  });

  test('启用的接入容器按管理员身份代建平台项目', async () => {
    const respond = routes({
      'POST /v1/catalog/service-plans': jsonResponse(200, {}),
      'POST /v1/catalog/task-profiles': jsonResponse(200, {}),
      'GET /v1/me': jsonResponse(200, ADMIN),
      'POST /v1/projects': jsonResponse(201, {}),
    });
    const files = filesFor('[git.example.com]', '{ gitlabEventProducer: { enabled: true }, referenceApiProxy: { enabled: true } }');
    const { checks, calls } = await initialize(files, respond);
    expect(checks.find((check) => check.label === '接入容器平台项目')?.outcome).toBe('ok');
    const created = calls.filter((call) => call.method === 'POST' && call.url.endsWith('/v1/projects'));
    expect(created.map((call) => (call.body as { slug: string }).slug)).toEqual(['gitlab-event-producer', 'reference-api-proxy']);
    expect(created[0]?.body).toMatchObject({ kind: 'EventProducer', template: '01a0bf5d-8f4b-7004-9cf7-0eb8bf66ffbc', ownerUserId: ADMIN.id });
    expect(created[1]?.body).toMatchObject({ kind: 'APIProxy', template: '01a0bf5d-8f4b-7003-9dbe-4adc78f388e9' });
  });

  test('项目已存在（409）按幂等处理，安装可以重跑', async () => {
    const respond = routes({
      'POST /v1/catalog/service-plans': jsonResponse(200, {}),
      'POST /v1/catalog/task-profiles': jsonResponse(200, {}),
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
      'POST /v1/catalog/service-plans': jsonResponse(200, {}),
      'POST /v1/catalog/task-profiles': jsonResponse(200, {}),
      'GET /v1/me': jsonResponse(200, { ...ADMIN, platformRole: 'user', isAdmin: false }),
    });
    const files = filesFor('[git.example.com]', '{ gitlabEventProducer: { enabled: true }, referenceApiProxy: { enabled: false } }');
    const { checks } = await initialize(files, respond);
    expect(checks.find((check) => check.label === '接入容器平台项目')?.outcome).toBe('pending-config');
  });

  test('平台 API 出错时这一步是失败，整体退出码 1', async () => {
    const respond = routes({ 'POST /v1/catalog/service-plans': jsonResponse(500, { error: 'internal', message: '目录写入失败', details: {} }) });
    const { code, checks } = await initialize(filesFor('[git.example.com]'), respond);
    expect(code).toBe(1);
    expect(checks.find((check) => check.label.includes('服务套餐'))?.outcome).toBe('failed');
  });

  test('平台没有路由的几件事如实报未实现', async () => {
    const respond = routes({
      'POST /v1/catalog/service-plans': jsonResponse(200, {}),
      'POST /v1/catalog/task-profiles': jsonResponse(200, {}),
    });
    const { checks } = await initialize(filesFor('[git.example.com]'), respond);
    const notImplemented = checks.filter((check) => check.outcome === 'not-implemented').map((check) => check.label);
    expect(notImplemented).toContain('最小样例模板');
    expect(notImplemented).toContain('源码托管连接、上游连接与开放策略');
  });

  test('安装不预置算力档位：单独报 pending-config 并说明要管理员创建、测试、设默认；旧包里的档位文件也不写入（RFC-006）', async () => {
    const respond = routes({
      'POST /v1/catalog/service-plans': jsonResponse(200, {}),
      'POST /v1/catalog/task-profiles': jsonResponse(200, {}),
    });
    const files = memoryFiles({
      '/install.yaml': yaml('[git.example.com]', '{ gitlabEventProducer: { enabled: false }, referenceApiProxy: { enabled: false } }'),
      '/bundle/release.lock.yaml': 'version: 0.1.0\n',
      '/bundle/profiles/service-plans.yaml': PLANS,
      '/bundle/profiles/task-profiles.yaml': PROFILES,
      '/bundle/profiles/compute-profiles.yaml': LEGACY_COMPUTE,
    }, BUNDLE_DIRS);
    const { checks, calls } = await initialize(files, respond);
    expect(checks.find((check) => check.label.includes('服务套餐'))?.outcome).toBe('ok');
    const compute = checks.find((check) => check.label === '算力档位');
    expect(compute?.outcome).toBe('pending-config');
    expect(compute?.detail).toContain('测试通过并设为默认');
    expect(calls.filter((call) => call.url.includes('compute-profiles'))).toHaveLength(0);
  });
});
