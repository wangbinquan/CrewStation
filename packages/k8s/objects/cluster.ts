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
 * 项目命名空间默认网络策略（T1.13）：入向只接受网关所在的平台系统命名空间，项目之间的隔离就靠这一条；
 * 出向不限制（D64）：数字人服务槽、迁移 Job 与任务容器、构建一样直连公网与公司内网。
 * 出向写成显式的全放行而不是去掉 Egress 类型：服务端 apply 整体替换这个列表，存量命名空间里旧的两条规则随之消失。
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
      egress: [{}],
    },
  };
}

/**
 * 任务容器与构建 Job 的出站：这两类 Pod 直接访问源码托管、依赖源与模型 API。
 * 默认策略的出向放开（D64）之后，这条与下面两条按标签放行的策略都不再起作用；仍然下发，
 * 是因为调和器对网络策略只建、只改回、从不删，撤掉它们要另给调和器补删除（作者 2026-09-24 选择保留）。
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
 * 因此它们的服务槽 Pod 直接访问上游，不再经平台转发通道。只对接入项目的命名空间下发。
 * D64 起默认策略已对所有 Pod 放开出向（数字人服务槽也在内），这条不再起作用，保留的原因同任务容器那条。
 */
export function integrationEgressNetworkPolicy(spec: { namespace: string }): K8sObject {
  return {
    apiVersion: 'networking.k8s.io/v1',
    kind: 'NetworkPolicy',
    metadata: { name: 'crewstation-integration-egress', namespace: spec.namespace, labels: platformLabels() },
    spec: { podSelector: { matchLabels: { 'crewstation.io/workload': 'service' } }, policyTypes: ['Egress'], egress: [{}] },
  };
}
