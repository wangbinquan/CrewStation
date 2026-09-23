import { describe, expect, test } from 'bun:test';
import { NETWORK_POLICY_TEMPLATES } from '../../domain/namespaceRender';
import { namespaceObjectOf, networkPolicyObjectOf, quotaObjectOf } from './namespaceObjects';

const render = { name: 'cs-demo', labels: { 'crewstation.io/project': 'demo' }, quota: { name: 'crewstation-project', hard: { pods: '30', 'requests.cpu': '8', 'requests.memory': '16Gi', persistentvolumeclaims: '20' } } };
const managed = { 'app.kubernetes.io/managed-by': 'crewstation' };

describe('调和器渲染的命名空间、额度与网络策略（RFC-025 第四期）', () => {
  // 与 provisioning 直接建时逐字段一致（namespaceProvisioning.test.ts 原来核对的对象），切换写入者时线上对象不变。
  test('命名空间带平台标签与项目标签，额度按期望的上限，都不加资源 ID 标签', () => {
    expect(namespaceObjectOf(render)).toEqual({ apiVersion: 'v1', kind: 'Namespace', metadata: { name: 'cs-demo', labels: { ...managed, 'crewstation.io/project': 'demo' } } });
    expect(quotaObjectOf(render)).toEqual({
      apiVersion: 'v1', kind: 'ResourceQuota', metadata: { name: 'crewstation-project', namespace: 'cs-demo', labels: managed },
      spec: { hard: { pods: '30', 'requests.cpu': '8', 'requests.memory': '16Gi', persistentvolumeclaims: '20' } },
    });
  });

  test('每个模板渲染成同名的网络策略；默认策略放行期望里的系统命名空间，接入出站只对服务槽', () => {
    for (const name of NETWORK_POLICY_TEMPLATES) {
      const object = networkPolicyObjectOf({ namespace: 'cs-demo', name, systemNamespace: 'crewstation-system' });
      expect({ kind: object.kind, name: object.metadata.name, namespace: object.metadata.namespace, labels: object.metadata.labels }).toEqual({ kind: 'NetworkPolicy', name, namespace: 'cs-demo', labels: managed });
    }
    const fallback = networkPolicyObjectOf({ namespace: 'cs-demo', name: 'crewstation-default', systemNamespace: 'cs-sys' }) as unknown as { spec: { ingress: unknown[] } };
    expect(fallback.spec.ingress).toEqual([{ from: [{ namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'cs-sys' } } }] }]);
    const integration = networkPolicyObjectOf({ namespace: 'cs-demo', name: 'crewstation-integration-egress', systemNamespace: 'cs-sys' }) as unknown as { spec: unknown };
    expect(integration.spec).toEqual({ podSelector: { matchLabels: { 'crewstation.io/workload': 'service' } }, policyTypes: ['Egress'], egress: [{}] });
  });
});
