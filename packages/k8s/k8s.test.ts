import { describe, expect, test } from 'bun:test';
import { createK8sClient } from './client';
import { loadClusterConfig } from './config';
import { createFakeK8sClient } from './fakeClient';
import { deploymentObject } from './objects/workloads';
import { ingressRouteObject } from './objects/traefik';
import { Resources, resourcePath } from './resources';

describe('资源路径', () => {
  test('核心组与命名组', () => {
    expect(resourcePath(Resources.Pod!, 'ns', 'p')).toBe('/api/v1/namespaces/ns/pods/p');
    expect(resourcePath(Resources.Deployment!, 'ns')).toBe('/apis/apps/v1/namespaces/ns/deployments');
    expect(resourcePath(Resources.Namespace!, undefined, 'x')).toBe('/api/v1/namespaces/x');
    expect(resourcePath(Resources.IngressRoute!, 'ns', 'r')).toBe('/apis/traefik.io/v1alpha1/namespaces/ns/ingressroutes/r');
  });
});

describe('对象构造器', () => {
  test('Deployment 带探针、资源与平台标签', () => {
    const d = deploymentObject({ name: 'w', namespace: 'cs-demo', labels: { 'crewstation.io/project': 'demo' }, selector: { app: 'w' }, replicas: 2, image: 'img:1', port: 3000, healthPath: '/healthz', resources: { cpu: '500m', memory: '512Mi' } });
    const spec = d.spec as { replicas: number; template: { spec: { containers: Array<Record<string, unknown>>; automountServiceAccountToken: boolean } } };
    expect(spec.replicas).toBe(2);
    expect(spec.template.spec.automountServiceAccountToken).toBe(false);
    expect(spec.template.spec.containers[0]?.readinessProbe).toBeDefined();
    expect(d.metadata.labels?.['app.kubernetes.io/managed-by']).toBe('crewstation');
  });
  test('IngressRoute 匹配规则', () => {
    const r = ingressRouteObject({ name: 'r', namespace: 'ns', host: 'demo.cs.localhost', pathPrefix: '/api/issues', target: { name: 'svc', port: 80 }, middlewares: [{ name: 'auth', namespace: 'crewstation-system' }] });
    const route = (r.spec as { routes: Array<{ match: string; middlewares: unknown[] }> }).routes[0]!;
    expect(route.match).toBe('Host(`demo.cs.localhost`) && PathPrefix(`/api/issues`)');
    expect(route.middlewares).toHaveLength(1);
  });
});

describe('服务端 dry-run（RFC-025 统一预检）', () => {
  test('dryRun 时 apply 带 dryRun=All，照常经 API Server 校验；内存客户端不落库', async () => {
    const urls: string[] = [];
    const client = createK8sClient({ server: 'https://cluster', token: 'token', defaultNamespace: 'default' }, (async (url: string) => { urls.push(url); return Response.json({ apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'a' } }); }) as typeof fetch);
    const obj = { apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'a', namespace: 'ns' }, data: {} };
    await client.apply(obj, { dryRun: true });
    await client.apply(obj);
    expect(new URL(urls[0]!).searchParams.get('dryRun')).toBe('All');
    expect(new URL(urls[1]!).searchParams.has('dryRun')).toBe(false);
    const fake = createFakeK8sClient();
    await fake.apply(obj, { dryRun: true });
    expect(fake.applied).toHaveLength(0);
    expect(await fake.get(Resources.ConfigMap!, 'a', 'ns')).toBeUndefined();
  });
});

describe('内存客户端', () => {
  test('apply 幂等、list 按标签过滤、delete 返回是否存在', async () => {
    const k = createFakeK8sClient();
    const obj = { apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'a', namespace: 'ns', labels: { x: '1' } }, data: {} };
    await k.apply(obj);
    await k.apply({ ...obj, data: { k: 'v' } });
    expect(k.applied).toHaveLength(2);
    expect((await k.list(Resources.ConfigMap!, 'ns', { labelSelector: 'x=1' })).length).toBe(1);
    expect((await k.get<typeof obj>(Resources.ConfigMap!, 'a', 'ns'))?.data).toEqual({ k: 'v' });
    expect(await k.delete(Resources.ConfigMap!, 'a', 'ns')).toBe(true);
    expect(await k.delete(Resources.ConfigMap!, 'a', 'ns')).toBe(false);
  });
});

describe.skipIf(process.env.CS_TEST_K8S !== '1')('真实集群（CS_TEST_K8S=1）', () => {
  test('kubeconfig 客户端证书可列出命名空间', async () => {
    const client = createK8sClient(loadClusterConfig());
    const namespaces = await client.list(Resources.Namespace!);
    expect(namespaces.map((n) => n.metadata.name)).toContain('kube-system');
  });
});
