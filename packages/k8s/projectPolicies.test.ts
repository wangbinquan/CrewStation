import { expect, test } from 'bun:test';
import { buildEgressNetworkPolicy, integrationEgressNetworkPolicy, projectNetworkPolicy, taskEgressNetworkPolicy } from './objects/cluster';

/** 项目命名空间的默认策略是唯一收紧出向的一条；它一旦放开，下面三条按标签放行的策略就没有意义了。 */
test('默认策略只放行 DNS 与平台系统命名空间，入向只收网关', () => {
  const policy = projectNetworkPolicy({ namespace: 'cs-demo', systemNamespace: 'crewstation-system' }) as unknown as { metadata: { name: string }; spec: Record<string, unknown> };
  expect(policy.metadata.name).toBe('crewstation-default');
  expect(policy.spec.podSelector).toEqual({});
  expect(policy.spec.policyTypes).toEqual(['Ingress', 'Egress']);
  expect(policy.spec.ingress).toEqual([{ from: [{ namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'crewstation-system' } } }] }]);
  expect(policy.spec.egress).toEqual([
    { to: [{ namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'kube-system' } } }], ports: [{ protocol: 'UDP', port: 53 }, { protocol: 'TCP', port: 53 }] },
    { to: [{ namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'crewstation-system' } } }] },
  ]);
});

/** RFC-018：接入容器的服务槽直接出站；选择器认 workload=service，改错标签会连带把数字人服务槽放开。 */
test('接入容器出站策略只选 workload=service 且出向全放行', () => {
  const policy = integrationEgressNetworkPolicy({ namespace: 'cs-proxy' }) as unknown as { metadata: { name: string; namespace: string }; spec: Record<string, unknown> };
  expect(policy.metadata).toMatchObject({ name: 'crewstation-integration-egress', namespace: 'cs-proxy' });
  expect(policy.spec.podSelector).toEqual({ matchLabels: { 'crewstation.io/workload': 'service' } });
  expect(policy.spec.policyTypes).toEqual(['Egress']);
  expect(policy.spec.egress).toEqual([{}]);
});

test('任务容器与构建的出站策略各自只选自己的负载', () => {
  const task = taskEgressNetworkPolicy({ namespace: 'cs-demo' }) as unknown as { metadata: { name: string }; spec: Record<string, unknown> };
  expect(task.metadata.name).toBe('crewstation-task-egress');
  expect(task.spec.podSelector).toEqual({ matchExpressions: [{ key: 'crewstation.io/workload', operator: 'In', values: ['dev-session', 'business-task'] }] });
  expect(task.spec.egress).toEqual([{}]);
  const build = buildEgressNetworkPolicy({ namespace: 'cs-demo' }) as unknown as { metadata: { name: string }; spec: Record<string, unknown> };
  expect(build.metadata.name).toBe('crewstation-build-egress');
  expect(build.spec.podSelector).toEqual({ matchLabels: { 'app.kubernetes.io/component': 'build' } });
  expect(build.spec.egress).toEqual([{}]);
});
