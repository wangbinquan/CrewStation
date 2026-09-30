import type { ProjectDeletionInventory } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';

type ProjectDeletionResource = ProjectDeletionInventory['resources'][number];
export interface DeletionClusterObject {
  readonly apiVersion: string; readonly kind: string;
  readonly metadata: { readonly name: string; readonly uid?: string; readonly namespace?: string; readonly labels?: Record<string, string>; readonly ownerReferences?: Array<{ apiVersion: string; kind: string; uid: string; name: string; controller?: boolean }> };
  readonly [key: string]: unknown;
}
export function clusterObjectResource(object: DeletionClusterObject): ProjectDeletionResource {
  if (!object.metadata.uid) throw precondition('集群对象缺少原实例 UID，不能确认清理');
  const claim = object.kind === 'PersistentVolume' ? (object['spec'] as { claimRef?: { uid?: string; namespace?: string } } | undefined)?.claimRef : undefined;
  return { kind: object.kind, id: JSON.stringify({ apiVersion: object.apiVersion, kind: object.kind, namespace: object.metadata.namespace, name: object.metadata.name }),
    identity: JSON.stringify({ uid: object.metadata.uid, digest: jsonHash({ spec: object['spec'], data: object['data'], binaryData: object['binaryData'], owners: object.metadata.ownerReferences }), ...(claim ? { claimUid: claim.uid, claimNamespace: claim.namespace } : {}) }), count: 1 };
}
export function originalUid(resource: ProjectDeletionResource): string {
  const value = JSON.parse(resource.identity) as { uid?: unknown };
  if (typeof value.uid !== 'string' || !value.uid) throw precondition('原集群实例身份不完整');
  return value.uid;
}
export function automaticClusterObject(object: DeletionClusterObject): boolean {
  if (object.kind === 'Event' && ['v1', 'events.k8s.io/v1'].includes(object.apiVersion)) return true;
  if (object.apiVersion !== 'v1') return false;
  if (object.kind === 'ServiceAccount' && object.metadata.name === 'default') return !(object['secrets'] as unknown[] | undefined)?.length && !(object['imagePullSecrets'] as unknown[] | undefined)?.length;
  return object.kind === 'ConfigMap' && object.metadata.name === 'kube-root-ca.crt' && !Object.keys((object['binaryData'] ?? {}) as object).length && Object.keys((object['data'] ?? {}) as object).every((key) => key === 'ca.crt');
}

/** 控制器自动生成的端点须追到本项目已认领的原 Service；有外部地址的手填端点不例外。 */
export function endpointService<T extends DeletionClusterObject>(object: T, objects: readonly T[]): T | undefined {
  if (object.kind === 'Endpoints' && object.apiVersion === 'v1' && object.metadata.labels?.['endpoints.kubernetes.io/managed-by'] === 'endpoint-controller') return objects.find((entry) => entry.kind === 'Service' && entry.apiVersion === 'v1' && entry.metadata.name === object.metadata.name);
  if (object.kind === 'EndpointSlice' && object.apiVersion === 'discovery.k8s.io/v1') {
    const owner = object.metadata.ownerReferences?.find((entry) => entry.controller && entry.apiVersion === 'v1' && entry.kind === 'Service');
    return owner ? objects.find((entry) => entry.kind === 'Service' && entry.metadata.uid === owner.uid && entry.metadata.name === owner.name) : undefined;
  }
  return undefined;
}
