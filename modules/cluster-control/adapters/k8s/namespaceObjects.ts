import type { K8sObject } from '@crewstation/k8s';
import { buildEgressNetworkPolicy, integrationEgressNetworkPolicy, namespaceObject, projectNetworkPolicy, resourceQuotaObject, taskEgressNetworkPolicy } from '@crewstation/k8s';
import type { NamespaceRender, NetworkPolicyRender, NetworkPolicyTemplate } from '../../domain/namespaceRender';

/**
 * 按命名空间记录渲染（RFC-025 第四期）：与 provisioning 直接建时同一组构造函数、同样的标签，切换写入者时线上对象不变。
 * 标签里不加资源 ID：命名空间与额度按名字归这条记录，线上对象一个字段都不用改。
 */
export function namespaceObjectOf(render: NamespaceRender): K8sObject {
  return namespaceObject(render.name, { ...render.labels });
}

export function quotaObjectOf(render: NamespaceRender): K8sObject {
  return resourceQuotaObject({ name: render.quota.name, namespace: render.name, hard: { ...render.quota.hard } });
}

const POLICIES: Readonly<Record<NetworkPolicyTemplate, (render: NetworkPolicyRender) => K8sObject>> = {
  'crewstation-default': (render) => projectNetworkPolicy({ namespace: render.namespace, systemNamespace: render.systemNamespace }),
  'crewstation-task-egress': (render) => taskEgressNetworkPolicy({ namespace: render.namespace }),
  'crewstation-build-egress': (render) => buildEgressNetworkPolicy({ namespace: render.namespace }),
  'crewstation-integration-egress': (render) => integrationEgressNetworkPolicy({ namespace: render.namespace }),
};

/** 按名字取模板渲染一条网络策略（模板的名字就是对象名）。 */
export function networkPolicyObjectOf(render: NetworkPolicyRender): K8sObject {
  return POLICIES[render.name](render);
}
