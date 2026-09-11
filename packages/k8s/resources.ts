export interface ObjectMeta {
  name?: string;
  namespace?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  resourceVersion?: string;
  uid?: string;
  generation?: number;
  creationTimestamp?: string;
  deletionTimestamp?: string;
  ownerReferences?: Array<{ apiVersion: string; kind: string; name: string; uid: string; controller?: boolean; blockOwnerDeletion?: boolean }>;
}

export interface K8sObject {
  apiVersion: string;
  kind: string;
  metadata: ObjectMeta & { name: string };
  [key: string]: unknown;
}

/** 客户端按 apiVersion＋kind 定位 REST 路径；未知 kind 用小写复数兜底。 */
export interface ResourceRef {
  apiVersion: string;
  kind: string;
  plural: string;
  namespaced: boolean;
}

const KNOWN: ResourceRef[] = [
  { apiVersion: 'v1', kind: 'Namespace', plural: 'namespaces', namespaced: false },
  { apiVersion: 'v1', kind: 'Pod', plural: 'pods', namespaced: true },
  { apiVersion: 'v1', kind: 'Service', plural: 'services', namespaced: true },
  { apiVersion: 'v1', kind: 'ConfigMap', plural: 'configmaps', namespaced: true },
  { apiVersion: 'v1', kind: 'Secret', plural: 'secrets', namespaced: true },
  { apiVersion: 'v1', kind: 'PersistentVolumeClaim', plural: 'persistentvolumeclaims', namespaced: true },
  { apiVersion: 'v1', kind: 'ServiceAccount', plural: 'serviceaccounts', namespaced: true },
  { apiVersion: 'v1', kind: 'ResourceQuota', plural: 'resourcequotas', namespaced: true },
  { apiVersion: 'v1', kind: 'Event', plural: 'events', namespaced: true },
  { apiVersion: 'apps/v1', kind: 'Deployment', plural: 'deployments', namespaced: true },
  { apiVersion: 'apps/v1', kind: 'StatefulSet', plural: 'statefulsets', namespaced: true },
  { apiVersion: 'batch/v1', kind: 'Job', plural: 'jobs', namespaced: true },
  { apiVersion: 'networking.k8s.io/v1', kind: 'NetworkPolicy', plural: 'networkpolicies', namespaced: true },
  { apiVersion: 'networking.k8s.io/v1', kind: 'Ingress', plural: 'ingresses', namespaced: true },
  { apiVersion: 'policy/v1', kind: 'PodDisruptionBudget', plural: 'poddisruptionbudgets', namespaced: true },
  { apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'Role', plural: 'roles', namespaced: true },
  { apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'RoleBinding', plural: 'rolebindings', namespaced: true },
  { apiVersion: 'traefik.io/v1alpha1', kind: 'IngressRoute', plural: 'ingressroutes', namespaced: true },
  { apiVersion: 'traefik.io/v1alpha1', kind: 'Middleware', plural: 'middlewares', namespaced: true },
];

export const Resources = Object.fromEntries(KNOWN.map((r) => [r.kind, r])) as Record<string, ResourceRef>;

export function refOf(obj: Pick<K8sObject, 'apiVersion' | 'kind'>): ResourceRef {
  const known = KNOWN.find((r) => r.apiVersion === obj.apiVersion && r.kind === obj.kind);
  return known ?? { apiVersion: obj.apiVersion, kind: obj.kind, plural: `${obj.kind.toLowerCase()}s`, namespaced: true };
}

export function resourcePath(ref: ResourceRef, namespace?: string, name?: string): string {
  const base = ref.apiVersion.includes('/') ? `/apis/${ref.apiVersion}` : `/api/${ref.apiVersion}`;
  const scope = ref.namespaced && namespace ? `/namespaces/${namespace}` : '';
  return `${base}${scope}/${ref.plural}${name ? `/${name}` : ''}`;
}

export type WatchEventType = 'ADDED' | 'MODIFIED' | 'DELETED' | 'BOOKMARK' | 'ERROR';
