import { expect, test } from 'bun:test';
import type { K8sObject } from '../resources';
import { serviceSlotObjects, serviceSlotSecret, slotObjectName } from './slot';

const input = {
  namespace: 'proj-demo', project: 'demo', service: 'demo', physical: 'green', releaseId: '01a0bf5d-8f4b-7000-8000-000000000001', image: 'registry.local:5000/demo:v0.1.0',
  command: ['bun', 'run', 'src/main.ts'], port: 3000, healthPath: '/healthz', replicas: 2, resources: { cpu: '250m', memory: '256Mi' },
} as const;

type Container = { env: unknown[]; envFrom?: unknown; image: string; imagePullPolicy: string; readinessProbe?: unknown };
const containerOf = (deployment: K8sObject) => ((deployment as { spec?: unknown }).spec as { template: { spec: { containers: Container[] } } }).template.spec.containers[0]!;

test('一个物理槽是同名的 Deployment 与 Service：选择器只认服务与物理槽，标签带项目、工作负载与版本', () => {
  const [deployment, service] = serviceSlotObjects({ ...input, env: { A: '1' } });
  expect(deployment.metadata.name).toBe(slotObjectName('demo', 'green'));
  expect(deployment.metadata.name).toBe('demo-green');
  expect(service.metadata.name).toBe('demo-green');
  const spec = (deployment as { spec?: unknown }).spec as { replicas: number; selector: { matchLabels: Record<string, string> }; template: { metadata: { labels: Record<string, string>; annotations?: unknown } } };
  expect(spec.selector.matchLabels).toEqual({ 'crewstation.io/service': 'demo', 'crewstation.io/slot': 'green' });
  expect(spec.replicas).toBe(2);
  expect(deployment.metadata.labels).toMatchObject({ 'crewstation.io/project': 'demo', 'crewstation.io/workload': 'service', 'crewstation.io/release': input.releaseId, 'app.kubernetes.io/managed-by': 'crewstation' });
  expect(spec.template.metadata.annotations).toBeUndefined();
  expect(deployment.metadata.annotations).toBeUndefined();
  expect(containerOf(deployment)).toMatchObject({ image: input.image, imagePullPolicy: 'Always', env: [{ name: 'A', value: '1' }] });
  expect(containerOf(deployment).envFrom).toBeUndefined();
  expect(((service as { spec?: unknown }).spec as { ports: unknown[] }).ports).toEqual([{ name: 'http', port: 80, targetPort: 3000, protocol: 'TCP' }]);
});

test('资源中心建的槽：环境只从 Secret 引用，Deployment 注解写期望版本，Pod 模板注解写重启标记', () => {
  const [deployment] = serviceSlotObjects({ ...input, envFromSecret: 'demo-green-env-3', annotations: { 'crewstation.io/resource-generation': '7' }, templateAnnotations: { 'crewstation.io/restarted-at': '2026-09-24T08:00:00.000Z' } });
  expect(containerOf(deployment).env).toEqual([]);
  expect(containerOf(deployment).envFrom).toEqual([{ secretRef: { name: 'demo-green-env-3' } }]);
  expect(deployment.metadata.annotations).toEqual({ 'crewstation.io/resource-generation': '7' });
  expect(((deployment as { spec?: unknown }).spec as { template: { metadata: { annotations: unknown } } }).template.metadata.annotations).toEqual({ 'crewstation.io/restarted-at': '2026-09-24T08:00:00.000Z' });
});

test('环境 Secret 不可变，标签与槽的对象相同', () => {
  const secret = serviceSlotSecret({ ...input, name: 'demo-green-env-3' }, { CS_DATABASE_URL: 'postgres://x' });
  expect(secret).toMatchObject({ kind: 'Secret', immutable: true, stringData: { CS_DATABASE_URL: 'postgres://x' }, metadata: { name: 'demo-green-env-3', namespace: 'proj-demo', labels: { 'crewstation.io/slot': 'green', 'crewstation.io/release': input.releaseId } } });
});
