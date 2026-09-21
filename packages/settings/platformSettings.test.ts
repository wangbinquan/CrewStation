import { expect, test } from 'bun:test';
import { loadPlatformSettings, portFrom } from './platformSettings';

const base = { CS_DATABASE_URL: 'postgres://test:test@localhost/test', CS_SECRET_KEY: 'test', POD_IP: '10.244.0.106' };

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
