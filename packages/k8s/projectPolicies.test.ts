import { expect, test } from 'bun:test';
import { buildEgressNetworkPolicy, integrationEgressNetworkPolicy, projectNetworkPolicy, taskEgressNetworkPolicy } from './objects/cluster';

/**
 * D64：项目命名空间里的所有 Pod（数字人服务槽、迁移 Job 在内）出向不限制；项目之间的隔离只剩入向这一条，
 * 改丢了入向的命名空间限定，别的项目就能直连进来。出向要写成显式的 `[{}]`：存量策略的旧规则靠服务端 apply 整体替换才会消失。
 */
test('默认策略出向全放行，入向只收平台系统命名空间', () => {
  const policy = projectNetworkPolicy({ namespace: 'cs-demo', systemNamespace: 'crewstation-system' }) as unknown as { metadata: { name: string }; spec: Record<string, unknown> };
  expect(policy.metadata.name).toBe('crewstation-default');
  expect(policy.spec.podSelector).toEqual({});
  expect(policy.spec.policyTypes).toEqual(['Ingress', 'Egress']);
  expect(policy.spec.ingress).toEqual([{ from: [{ namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'crewstation-system' } } }] }]);
  expect(policy.spec.egress).toEqual([{}]);
});

/** RFC-018：接入容器的服务槽直接出站；D64 之后默认策略已放开出向，这条不再起作用，但仍按原形状下发。 */
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
