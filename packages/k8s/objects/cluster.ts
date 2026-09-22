import type { K8sObject } from '../resources';
import { platformLabels } from './labels';

export function namespaceObject(name: string, labels: Record<string, string> = {}): K8sObject {
  return { apiVersion: 'v1', kind: 'Namespace', metadata: { name, labels: platformLabels(labels) } };
}

export function serviceObject(spec: { name: string; namespace: string; selector: Record<string, string>; port: number; targetPort?: number; labels?: Record<string, string> }): K8sObject {
  return {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: { name: spec.name, namespace: spec.namespace, labels: platformLabels(spec.labels ?? {}) },
    spec: { type: 'ClusterIP', selector: spec.selector, ports: [{ name: 'http', port: spec.port, targetPort: spec.targetPort ?? spec.port, protocol: 'TCP' }] },
  };
}

export function pvcObject(spec: { name: string; namespace: string; size: string; storageClass?: string; labels?: Record<string, string> }): K8sObject {
  return {
    apiVersion: 'v1',
    kind: 'PersistentVolumeClaim',
    metadata: { name: spec.name, namespace: spec.namespace, labels: platformLabels(spec.labels ?? {}) },
    spec: { accessModes: ['ReadWriteOnce'], resources: { requests: { storage: spec.size } }, ...(spec.storageClass ? { storageClassName: spec.storageClass } : {}) },
  };
}

export function secretObject(spec: { name: string; namespace: string; stringData: Record<string, string>; labels?: Record<string, string> }): K8sObject {
  return { apiVersion: 'v1', kind: 'Secret', metadata: { name: spec.name, namespace: spec.namespace, labels: platformLabels(spec.labels ?? {}) }, type: 'Opaque', stringData: spec.stringData };
}

export function configMapObject(spec: { name: string; namespace: string; data: Record<string, string>; labels?: Record<string, string> }): K8sObject {
  return { apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: spec.name, namespace: spec.namespace, labels: platformLabels(spec.labels ?? {}) }, data: spec.data };
}

export function resourceQuotaObject(spec: { name: string; namespace: string; hard: Record<string, string> }): K8sObject {
  return { apiVersion: 'v1', kind: 'ResourceQuota', metadata: { name: spec.name, namespace: spec.namespace, labels: platformLabels() }, spec: { hard: spec.hard } };
}

/**
 * 项目命名空间默认网络策略（T1.13）：只接受网关所在命名空间的入向；出向只允许 DNS 与平台系统命名空间。
 * 数字人服务槽到公司系统的流量走接口目录与网关放行表，因此这里不放行任意外网。
 */
export function projectNetworkPolicy(spec: { namespace: string; systemNamespace: string }): K8sObject {
  return {
    apiVersion: 'networking.k8s.io/v1',
    kind: 'NetworkPolicy',
    metadata: { name: 'crewstation-default', namespace: spec.namespace, labels: platformLabels() },
    spec: {
      podSelector: {},
      policyTypes: ['Ingress', 'Egress'],
      ingress: [{ from: [{ namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': spec.systemNamespace } } }] }],
      egress: [
        { to: [{ namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'kube-system' } } }], ports: [{ protocol: 'UDP', port: 53 }, { protocol: 'TCP', port: 53 }] },
        { to: [{ namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': spec.systemNamespace } } }] },
      ],
    },
  };
}

/**
 * 任务容器与构建 Job 的出站：这两类 Pod 直接访问源码托管、依赖源与模型 API。
 * RFC-018 下线出站白名单后这是最终形态，不再有按域名收窄的后续步骤。
 * NetworkPolicy 取并集，因此只对带对应标签的 Pod 生效；其余业务 Pod 仍受 projectNetworkPolicy 约束。
 */
export function taskEgressNetworkPolicy(spec: { namespace: string }): K8sObject {
  return {
    apiVersion: 'networking.k8s.io/v1',
    kind: 'NetworkPolicy',
    metadata: { name: 'crewstation-task-egress', namespace: spec.namespace, labels: platformLabels() },
    spec: {
      podSelector: { matchExpressions: [{ key: 'crewstation.io/workload', operator: 'In', values: ['dev-session', 'business-task'] }] },
      policyTypes: ['Egress'],
      egress: [{}],
    },
  };
}

export function buildEgressNetworkPolicy(spec: { namespace: string }): K8sObject {
  return {
    apiVersion: 'networking.k8s.io/v1',
    kind: 'NetworkPolicy',
    metadata: { name: 'crewstation-build-egress', namespace: spec.namespace, labels: platformLabels() },
    spec: { podSelector: { matchLabels: { 'app.kubernetes.io/component': 'build' } }, policyTypes: ['Egress'], egress: [{}] },
  };
}

/**
 * 接入容器服务槽的出站（RFC-018，作者裁定 Q1＝C）：`APIProxy` 与 `EventProducer` 的职责就是代公司系统转发，
 * 因此它们的服务槽 Pod 直接访问上游，不再经平台转发通道。只对接入项目的命名空间下发；
 * 数字人项目不下发，其服务槽仍只到 DNS 与平台系统命名空间，访问公司系统必须经接口目录与网关放行表。
 */
export function integrationEgressNetworkPolicy(spec: { namespace: string }): K8sObject {
  return {
    apiVersion: 'networking.k8s.io/v1',
    kind: 'NetworkPolicy',
    metadata: { name: 'crewstation-integration-egress', namespace: spec.namespace, labels: platformLabels() },
    spec: { podSelector: { matchLabels: { 'crewstation.io/workload': 'service' } }, policyTypes: ['Egress'], egress: [{}] },
  };
}
