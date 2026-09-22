import { describe, expect, test } from 'bun:test';
import { INSTALL_PHASE_IDS } from '../cluster/installPlan';
import { worstOutcome } from '../cluster/installReport';
import { UPGRADE_ORDER } from '../cluster/upgradePlan';
import { clusterOk, fakeCluster, jsonResponse, memoryFiles, routes, runForTest } from './cliHarness';

const INSTALL_YAML = `
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
integrations: { gitlabEventProducer: { enabled: false }, referenceApiProxy: { enabled: false } }
egress: { mode: proxy, allowlist: [git.example.com] }
`;

const BUNDLE_DIRS = ['/bundle', '/bundle/charts', '/bundle/images', '/bundle/schemas', '/bundle/profiles', '/bundle/migrations', '/bundle/checks', '/bundle/licenses-and-sbom', '/bundle/templates/minimal-sample', '/bundle/templates/gitlab-event-producer', '/bundle/templates/reference-api-proxy'];
const FILES = memoryFiles({ '/install.yaml': INSTALL_YAML, '/bundle/release.lock.yaml': 'version: 0.1.0\n' }, BUNDLE_DIRS);

const HEALTHY_CLUSTER = {
  'version': clusterOk('{"clientVersion":{}}'),
  'config current-context': clusterOk('docker-desktop\n'),
  '-n crewstation-system get namespace': clusterOk('namespace/crewstation-system\n'),
  'get namespace': clusterOk('namespace/crewstation-system\n'),
  'get storageclass': clusterOk('standard=true\nfast=\n'),
};

describe('结论取最差', () => {
  test('失败压倒一切，未实现压过待配置', () => {
    expect(worstOutcome(['ok', 'limited', 'failed'])).toBe('failed');
    expect(worstOutcome(['ok', 'pending-config', 'not-implemented'])).toBe('not-implemented');
    expect(worstOutcome(['ok', 'skipped'])).toBe('ok');
    expect(worstOutcome([])).toBe('skipped');
  });
});

describe('install', () => {
  test('缺 --config 是用法错误', async () => {
    expect((await runForTest(['install', '--bundle', '/bundle'], { files: FILES })).code).toBe(2);
  });

  test('缺 --bundle 是用法错误', async () => {
    expect((await runForTest(['install', '--config', '/install.yaml'], { files: FILES })).code).toBe(2);
  });

  test('预检阶段真的问集群，并把结果写进报告', async () => {
    const cluster = fakeCluster(HEALTHY_CLUSTER);
    const result = await runForTest(['install', '--config', '/install.yaml', '--bundle', '/bundle', '--only', 'preflight'], { files: FILES, cluster });
    expect(cluster.commands).toContain('version -o json');
    expect(cluster.commands).toContain('config current-context');
    const text = result.out.join('\n');
    expect(text).toContain('docker-desktop');
    expect(text).toContain('standard');
  });

  test('未实现的阶段如实报未实现，整体不算成功（退出码 1）', async () => {
    const cluster = fakeCluster(HEALTHY_CLUSTER);
    const respond = routes({});
    const result = await runForTest(['install', '--config', '/install.yaml', '--bundle', '/bundle', '--json'], { files: FILES, cluster, respond });
    expect(result.code).toBe(1);
    const report = JSON.parse(result.out.join('\n')) as { outcome: string; phases: { id: string; outcome: string }[] };
    expect(report.outcome).toBe('not-implemented');
    expect(report.phases.map((phase) => phase.id)).toEqual([...INSTALL_PHASE_IDS]);
    for (const id of ['base', 'data', 'platform', 'acceptance']) {
      expect(report.phases.find((phase) => phase.id === id)?.outcome).toBe('not-implemented');
    }
  });

  test('集群连不上时预检就是失败，不继续假装', async () => {
    const cluster = fakeCluster({ version: { code: 127, stdout: '', stderr: '无法执行 kubectl' } });
    const result = await runForTest(['install', '--config', '/install.yaml', '--bundle', '/bundle', '--only', 'preflight', '--json'], { files: FILES, cluster });
    expect(result.code).toBe(1);
    const report = JSON.parse(result.out.join('\n')) as { outcome: string };
    expect(report.outcome).toBe('failed');
  });

  test('--only 写错阶段名是用法错误', async () => {
    const result = await runForTest(['install', '--config', '/install.yaml', '--bundle', '/bundle', '--only', 'nope'], { files: FILES, cluster: fakeCluster(HEALTHY_CLUSTER) });
    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toContain('preflight');
  });

  test('--dry-run 不写平台目录', async () => {
    const cluster = fakeCluster(HEALTHY_CLUSTER);
    const result = await runForTest(['install', '--config', '/install.yaml', '--bundle', '/bundle', '--only', 'initialize', '--dry-run', '--json'], { files: FILES, cluster });
    const report = JSON.parse(result.out.join('\n')) as { phases: { checks: { outcome: string }[] }[] };
    expect(report.phases[0]?.checks[0]?.outcome).toBe('skipped');
    expect(result.calls).toHaveLength(0);
  });

  test('没有令牌时初始化是待配置，而不是悄悄跳过', async () => {
    const cluster = fakeCluster(HEALTHY_CLUSTER);
    const result = await runForTest(['install', '--config', '/install.yaml', '--bundle', '/bundle', '--only', 'initialize', '--json'], { files: FILES, cluster, env: {} });
    const report = JSON.parse(result.out.join('\n')) as { phases: { checks: { outcome: string; detail: string }[] }[] };
    expect(report.phases[0]?.checks[0]?.outcome).toBe('pending-config');
    expect(report.phases[0]?.checks[0]?.detail).toContain('没有平台令牌');
  });
});

describe('upgrade', () => {
  const DEPLOYMENTS = 'cs-api\ncs-auth\ncs-controller\ncs-session\ncs-events\n';
  const script = {
    'version': clusterOk('{}'),
    '-n crewstation-system get deployments -o jsonpath': clusterOk(DEPLOYMENTS),
    '-n crewstation-system rollout restart': clusterOk('restarted\n'),
    '-n crewstation-system rollout status': clusterOk('deployment successfully rolled out\n'),
  };

  test('按固定顺序滚动，cs-session 最后', async () => {
    const cluster = fakeCluster(script);
    const result = await runForTest(['upgrade', '--config', '/install.yaml', '--bundle', '/bundle', '--only', 'rollout'], { files: FILES, cluster });
    const restarted = cluster.commands.filter((command) => command.includes('rollout restart')).map((command) => command.split('deployment/')[1] ?? '');
    expect(restarted).toEqual(['cs-auth', 'cs-api', 'cs-events', 'cs-controller', 'cs-session']);
    expect(restarted[restarted.length - 1]).toBe('cs-session');
    expect(result.out.join('\n')).toContain('cs-session');
  });

  test('滚动顺序里 cs-session 排在 cs-controller 之后', () => {
    expect(UPGRADE_ORDER.indexOf('cs-session')).toBeGreaterThan(UPGRADE_ORDER.indexOf('cs-controller'));
  });

  test('发行包没有迁移作业时报未实现', async () => {
    const cluster = fakeCluster(script);
    const result = await runForTest(['upgrade', '--config', '/install.yaml', '--bundle', '/bundle', '--only', 'migrate', '--json'], { files: FILES, cluster });
    expect(result.code).toBe(1);
    const report = JSON.parse(result.out.join('\n')) as { phases: { checks: { outcome: string; detail: string }[] }[] };
    expect(report.phases[0]?.checks[0]?.outcome).toBe('not-implemented');
    expect(report.phases[0]?.checks[0]?.detail).toContain('migrations/job.yaml');
  });

  test('--dry-run 不执行 rollout', async () => {
    const cluster = fakeCluster(script);
    await runForTest(['upgrade', '--config', '/install.yaml', '--bundle', '/bundle', '--only', 'rollout', '--dry-run'], { files: FILES, cluster });
    expect(cluster.commands.some((command) => command.includes('rollout restart'))).toBe(false);
  });
});

describe('status', () => {
  const deployments = JSON.stringify({
    items: [
      { metadata: { name: 'cs-api' }, spec: { replicas: 2, template: { spec: { containers: [{ image: 'cs-control-plane:dev' }] } } }, status: { readyReplicas: 2, updatedReplicas: 2 } },
      { metadata: { name: 'cs-session' }, spec: { replicas: 1, template: { spec: { containers: [{ image: 'cs-control-plane:dev' }] } } }, status: {} },
    ],
  });

  test('列出副本并说明各配置项来自哪一层，但不回显令牌', async () => {
    const cluster = fakeCluster({ '-n crewstation-system get deployments -o json': clusterOk(deployments) });
    const result = await runForTest(['status'], { cluster, env: { CS_TOKEN: 'secret-value' } });
    const text = result.out.join('\n');
    expect(result.code).toBe(0);
    expect(text).toContain('cs-api');
    expect(text).toContain('已配置（来源：环境变量）');
    expect(text).not.toContain('secret-value');
  });

  test('--json 里令牌只是布尔值', async () => {
    const cluster = fakeCluster({ '-n crewstation-system get deployments -o json': clusterOk(deployments) });
    const result = await runForTest(['status', '--json'], { cluster, env: { CS_TOKEN: 'secret-value' } });
    const payload = JSON.parse(result.out.join('\n')) as { config: { tokenConfigured: boolean }; deployments: { name: string; ready: number }[] };
    expect(payload.config.tokenConfigured).toBe(true);
    expect(result.out.join('\n')).not.toContain('secret-value');
    expect(payload.deployments.find((row) => row.name === 'cs-session')?.ready).toBe(0);
  });

  test('kubectl 不可用时说清楚，而不是报空表', async () => {
    const cluster = fakeCluster({});
    const result = await runForTest(['status'], { cluster });
    expect(result.out.join('\n')).toContain('读不到集群里的 Deployment');
  });
});

describe('verify', () => {
  const READY = 'cs-api=2/2\ncs-auth=1/1\ncs-controller=1/1\ncs-session=1/1\ncs-events=1/1\n';
  const ME = { id: `usr_${'a'.padEnd(32, '0')}`, name: '张三', email: 'z@example.com', platformRole: 'user', isAdmin: false, memberships: [], authMethod: 'password' as const };

  test('smoke：有令牌时用 /v1/me 一次验路由、身份与 cs-api', async () => {
    const cluster = fakeCluster({ '-n crewstation-system get deployments -o jsonpath': clusterOk(READY) });
    const result = await runForTest(['verify', '--suite', 'smoke', '--json'], {
      cluster,
      respond: routes({ 'GET /v1/me': jsonResponse(200, ME), 'GET /': jsonResponse(302, {}) }),
    });
    const report = JSON.parse(result.out.join('\n')) as { phases: { checks: { label: string; outcome: string }[] }[] };
    const checks = report.phases[0]?.checks ?? [];
    expect(checks.find((check) => check.label === '平台 API 健康')?.outcome).toBe('ok');
    expect(checks.find((check) => check.label === '常驻服务副本')?.outcome).toBe('ok');
    expect(checks.find((check) => check.label.includes('源 IP'))?.outcome).toBe('not-implemented');
    expect(result.code).toBe(1);
  });

  test('smoke：没有令牌时 /healthz 的 401 算受限，不算失败', async () => {
    const cluster = fakeCluster({ '-n crewstation-system get deployments -o jsonpath': clusterOk(READY) });
    const result = await runForTest(['verify', '--json'], {
      cluster, env: {},
      respond: routes({ 'GET /healthz': jsonResponse(401, { error: 'unauthenticated', message: '要登录', details: {} }), 'GET /': jsonResponse(401, {}) }),
    });
    const report = JSON.parse(result.out.join('\n')) as { phases: { checks: { label: string; outcome: string; detail: string }[] }[] };
    const api = report.phases[0]?.checks.find((check) => check.label === '平台 API 健康');
    expect(api?.outcome).toBe('limited');
    expect(api?.detail).toContain('配置令牌后重跑');
  });

  test('smoke：令牌无效时平台健康是失败', async () => {
    const cluster = fakeCluster({ '-n crewstation-system get deployments -o jsonpath': clusterOk(READY) });
    const result = await runForTest(['verify', '--json'], {
      cluster,
      respond: routes({ 'GET /v1/me': jsonResponse(401, { error: 'unauthenticated', message: '会话已过期', details: {} }), 'GET /': jsonResponse(200, {}) }),
    });
    const report = JSON.parse(result.out.join('\n')) as { phases: { checks: { label: string; outcome: string; detail: string }[] }[] };
    const api = report.phases[0]?.checks.find((check) => check.label === '平台 API 健康');
    expect(api?.outcome).toBe('failed');
    expect(api?.detail).toContain('会话已过期');
  });

  test('副本没起来就是失败', async () => {
    const cluster = fakeCluster({ '-n crewstation-system get deployments -o jsonpath': clusterOk('cs-api=0/2\ncs-auth=1/1\ncs-controller=1/1\ncs-session=1/1\ncs-events=1/1\n') });
    const result = await runForTest(['verify', '--json'], { cluster, respond: routes({ 'GET /healthz': jsonResponse(200, {}), 'GET /': jsonResponse(200, {}) }) });
    const report = JSON.parse(result.out.join('\n')) as { phases: { checks: { label: string; outcome: string }[] }[] };
    expect(report.phases[0]?.checks.find((check) => check.label === '常驻服务副本')?.outcome).toBe('failed');
    expect(result.code).toBe(1);
  });

  test('acceptance 套件整套都是未实现', async () => {
    const result = await runForTest(['verify', '--suite', 'acceptance', '--json'], { cluster: fakeCluster({}) });
    const report = JSON.parse(result.out.join('\n')) as { outcome: string; phases: { checks: { outcome: string }[] }[] };
    expect(report.outcome).toBe('not-implemented');
    expect(report.phases[0]?.checks.every((check) => check.outcome === 'not-implemented')).toBe(true);
  });

  test('未知套件是用法错误', async () => {
    const result = await runForTest(['verify', '--suite', 'nope'], { cluster: fakeCluster({}) });
    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toContain('smoke');
  });
});
