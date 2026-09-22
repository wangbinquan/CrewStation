import { describe, expect, test } from 'bun:test';
import { DEFAULT_NAMESPACE, parseInstallConfig } from '../cluster/installConfig';
import { inspectBundle, readBundleProfiles } from '../cluster/releaseBundle';
import { CliFailure } from '../runtime/cliError';
import { memoryFiles } from './cliHarness';

const FULL = `
profile: production
namespace: cs-system
controlPlane:
  replicas: 3
network:
  ingressMode: LoadBalancer
  consoleHost: studio.example.com
  appsDomain: apps.example.net
  previewDomain: preview.example.net
  serviceDomain: svc.crewstation.internal
  sourceIpPreserved: true
sourceControl:
  mode: external
  provider: gitlab-compatible
  baseUrl: https://git.example.com
  groupId: "1234"
  protectedTagPattern: "v*"
integrations:
  gitlabEventProducer: { enabled: true }
  referenceApiProxy: { enabled: false }
egress:
  mode: proxy
  allowlist: [git.example.com, "*.mirror.example.com"]
quotas: { defaultConcurrentTasksPerWorker: 3 }
`;

describe('install.yaml', () => {
  test('Design §11.3 的样例逐字段解析出来', () => {
    const config = parseInstallConfig(FULL, '/install.yaml');
    expect(config.profile).toBe('production');
    expect(config.namespace).toBe('cs-system');
    expect(config.controlPlaneReplicas).toBe(3);
    expect(config.consoleHost).toBe('studio.example.com');
    expect(config.serviceDomain).toBe('svc.crewstation.internal');
    expect(config.sourceIpPreserved).toBe(true);
    expect(config.sourceControlGroupId).toBe('1234');
    expect(config.gitlabEventProducer).toBe(true);
    expect(config.referenceApiProxy).toBe(false);
    expect(config.defaultConcurrentTasksPerWorker).toBe(3);
    // RFC-018：旧配置里的 egress 段被忽略而不是报错，原样留在 raw 里，升级不必先改配置文件。
    expect('egressAllowlist' in config).toBe(false);
    expect(config.raw.egress).toEqual({ mode: 'proxy', allowlist: ['git.example.com', '*.mirror.example.com'] });
  });

  test('没写 namespace 时落到默认值', () => {
    const config = parseInstallConfig(FULL.replace('namespace: cs-system', ''), '/install.yaml');
    expect(config.namespace).toBe(DEFAULT_NAMESPACE);
  });

  test('一次报出全部问题，而不是只报第一条', () => {
    let failure: CliFailure | undefined;
    try {
      parseInstallConfig('profile: whatever\ncontrolPlane: { replicas: 0 }\n', '/install.yaml');
    } catch (error) {
      failure = error instanceof CliFailure ? error : undefined;
    }
    const text = failure?.detail.join('\n') ?? '';
    expect(failure?.message).toContain('/install.yaml');
    expect(text).toContain('profile');
    expect(text).toContain('network.consoleHost');
    expect(text).toContain('sourceControl.baseUrl');
    expect(text).toContain('controlPlane.replicas');
  });

  test('顶层不是映射就报错', () => {
    expect(() => parseInstallConfig('- 1\n- 2\n', '/install.yaml')).toThrow(CliFailure);
  });
});

describe('发行包', () => {
  const dirs = ['/bundle', '/bundle/charts', '/bundle/images', '/bundle/profiles'];
  const files = {
    '/bundle/release.lock.yaml': 'version: 1.4.0\nimages:\n  cs-api: sha256:abc\n  cs-session: sha256:def\n',
    '/bundle/profiles/service-plans.yaml': '- { id: 01a0bf5d-8f4b-7000-9e4b-b54e91ee9d10, name: standard-small, cpu: "500m", memory: 512Mi, maxReplicas: 3 }\n- { name: broken }\n',
    '/bundle/profiles/task-profiles.yaml': '- { id: 01a0bf5d-8f4b-7001-8458-107366e7de39, name: coding-medium, cpu: "1", memory: 2Gi, storage: 10Gi }\n',
    // 旧发行包的档位文件：RFC-006 起不再读取（安装不预置档位）。
    '/bundle/profiles/compute-profiles.yaml': '- { name: balanced, driver: claude-code, model: anthropic/claude-sonnet-5 }\n',
  };

  test('逐项报告 Design §11.2 的目录在不在', () => {
    const bundle = inspectBundle(memoryFiles(files, dirs), '/bundle');
    expect(bundle.version).toBe('1.4.0');
    expect(bundle.images).toEqual(['cs-api@sha256:abc', 'cs-session@sha256:def']);
    expect(bundle.entries.find((entry) => entry.path === 'charts')?.present).toBe(true);
    expect(bundle.missing).toContain('templates/minimal-sample');
    expect(bundle.missing).toContain('checks');
  });

  test('目录不存在直接报错，不装半截', () => {
    expect(() => inspectBundle(memoryFiles({}), '/nope')).toThrow(CliFailure);
  });

  test('套餐字段不全的条目被忽略并记一笔', () => {
    const profiles = readBundleProfiles(memoryFiles(files, dirs), '/bundle');
    expect(profiles.servicePlans.map((plan) => plan.name)).toEqual(['standard-small']);
    expect(profiles.taskProfiles.map((plan) => plan.name)).toEqual(['coding-medium']);
    expect(profiles).not.toHaveProperty('computeProfiles');
    expect(profiles.notes.join('\n')).toContain('1 条字段不全');
    expect(profiles.notes.join('\n')).not.toContain('compute-profiles');
  });

  test('缺 profiles 文件不是错误，只是记一笔', () => {
    const profiles = readBundleProfiles(memoryFiles({}, ['/bundle']), '/bundle');
    expect(profiles.servicePlans).toEqual([]);
    expect(profiles.notes).toHaveLength(2);
  });
});
