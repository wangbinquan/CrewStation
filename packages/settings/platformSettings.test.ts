import { expect, test } from 'bun:test';
import { loadPlatformSettings, portFrom } from './platformSettings';

const base = { CS_DATABASE_URL: 'postgres://test:test@localhost/test', CS_SECRET_KEY: 'test', POD_IP: '10.244.0.106' };

test('RF1 object storage needs an explicit local installation mode; spelling errors cannot bypass production durability', () => {
  expect(loadPlatformSettings(base).objectStorage?.deploymentMode).toBe('production');
  expect(loadPlatformSettings(base).objectStorage?.apiUrl).toBe(`http://api.${loadPlatformSettings(base).serviceDomain}:8088`);
  expect(loadPlatformSettings({ ...base, CS_OBJECT_API_URL: 'https://api.test:8088' }).objectStorage?.apiUrl).toBe('https://api.test:8088');
  expect(loadPlatformSettings({ ...base, CS_OBJECT_STORAGE_MODE: 'local' }).objectStorage?.deploymentMode).toBe('local');
  expect(() => loadPlatformSettings({ ...base, CS_OBJECT_STORAGE_MODE: 'Local' })).toThrow('CS_OBJECT_STORAGE_MODE');
});

test('缺省任务镜像与受管底座一致，准入可以解析摘要；显式镜像配置不被替换', () => {
  const defaults = loadPlatformSettings(base);
  expect(defaults.taskImage).toBe(`${defaults.registryBase}/${defaults.baseImage.repository}:${defaults.baseImage.tag}`);
  const configured = loadPlatformSettings({ ...base, CS_REGISTRY_BASE: 'registry.test:5000', CS_BASE_IMAGE_REPOSITORY: 'platform/task', CS_BASE_IMAGE_TAG: 'v2' });
  expect(configured.taskImage).toBe('registry.test:5000/platform/task:v2');
  expect(loadPlatformSettings({ ...base, CS_TASK_IMAGE: 'custom.test/task:fixed' }).taskImage).toBe('custom.test/task:fixed');
});

test('session 副本地址使用实际监听端口，不读取 Kubernetes 同名 Service 变量', () => {
  const env = { ...base, CS_SESSION_PORT: 'tcp://10.96.116.44:8083' };
  // 实机地址曾被拼成 http://PodIP:tcp://ServiceIP:8083，跨副本命令永久等待。
  expect(loadPlatformSettings(env).selfAddress).toBe(`http://${base.POD_IP}:${portFrom(env, 'cs-session', 8083)}`);
  expect(loadPlatformSettings({ ...env, CS_CS_SESSION_PORT: '9083' }).selfAddress).toBe('http://10.244.0.106:9083');
  expect(loadPlatformSettings({ ...env, CS_SELF_ADDRESS: 'http://session:9083' }).selfAddress).toBe('http://session:9083');
});

test('无集群注入时默认副本地址与监听一致', () => {
  expect(loadPlatformSettings({ ...base, POD_IP: undefined }).selfAddress).toBe('http://127.0.0.1:8083');
});

test('cluster metrics is opt-in and uses independent installation credentials and node root', () => {
  expect(loadPlatformSettings(base).clusterMetrics).toMatchObject({ enabled: false, probePort: 8095, probeRoot: '' });
  expect(loadPlatformSettings({ ...base, CS_SYSTEM_NAMESPACE: 'platform', CS_CLUSTER_METRICS_ENABLED: 'true', CS_CLUSTER_METRICS_TOKEN: 'export', CS_PROMETHEUS_TOKEN: 'query', CS_STORAGE_PROBE_TOKEN: 'probe', CS_STORAGE_PROBE_HOST_ROOT: '/local', CS_STORAGE_PROBE_PORT: '9000' }).clusterMetrics).toEqual({ enabled: true, exporterToken: 'export', prometheusUrl: 'http://prometheus.platform.svc.cluster.local:9090', prometheusToken: 'query', probeToken: 'probe', probeRoot: '/local', probePort: 9000 });
});

test('工作区容器缺省由资源中心建出，只有显式 owner 才回退（RFC-025 I25）', () => {
  expect(loadPlatformSettings(base).workloadCreation).toBe('ledger');
  expect(loadPlatformSettings({ ...base, CS_WORKLOAD_CREATION: 'owner' }).workloadCreation).toBe('owner');
  // 拼错的值不悄悄回退：仍由资源中心建。
  expect(loadPlatformSettings({ ...base, CS_WORKLOAD_CREATION: 'Owner' }).workloadCreation).toBe('ledger');
});

test('生产库、开发库缺省由 data-control 建，只有显式 data 才回退（RFC-025 I28）', () => {
  expect(loadPlatformSettings(base).dataProvisioning).toBe('data-control');
  expect(loadPlatformSettings({ ...base, CS_DATA_PROVISIONING: 'data' }).dataProvisioning).toBe('data');
  expect(loadPlatformSettings({ ...base, CS_DATA_PROVISIONING: 'Data' }).dataProvisioning).toBe('data-control');
});

test('服务槽与构建、迁移 Job 缺省由资源中心建，只有显式 owner 才回退为 release 自己建（RFC-025 T8）', () => {
  expect(loadPlatformSettings(base).releaseCreation).toBe('ledger');
  expect(loadPlatformSettings({ ...base, CS_RELEASE_CREATION: 'owner' }).releaseCreation).toBe('owner');
  expect(loadPlatformSettings({ ...base, CS_RELEASE_CREATION: 'Owner' }).releaseCreation).toBe('ledger');
});
