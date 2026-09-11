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
 * 项目命名空间默认网络策略（T1.13）：只接受网关所在命名空间的入向；出向只允许 DNS、平台系统命名空间与出站代理。
 * 业务到公司系统的流量必须经代理，因此不放行任意外网。
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
