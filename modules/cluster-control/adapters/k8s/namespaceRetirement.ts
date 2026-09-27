import type { K8sClient, K8sObject } from '@crewstation/k8s';
import { Resources } from '@crewstation/k8s';
import { conflict, precondition } from '@crewstation/kernel';

import type { NamespaceRetirement } from '../../domain/namespaceRetirement';

/** 只有系统自动脚手架可略过；未知对象一律阻断。 */
function automatic(object: K8sObject): boolean {
  if (object.kind === 'Event' && ['v1', 'events.k8s.io/v1'].includes(object.apiVersion)) return true;
  if (object.apiVersion !== 'v1') return false;
  if (object.kind === 'ServiceAccount' && object.metadata.name === 'default') return !(object.secrets as unknown[] | undefined)?.length && !(object.imagePullSecrets as unknown[] | undefined)?.length;
  return object.kind === 'ConfigMap' && object.metadata.name === 'kube-root-ca.crt' && !Object.keys((object.binaryData ?? {}) as object).length && Object.keys((object.data ?? {}) as object).every((key) => key === 'ca.crt');
}

/** Service 控制器生成的空端点；有地址的端点仍阻断，不能把尚有后端的入口当脚手架。 */
function idleEndpoints(object: K8sObject, expected: NamespaceRetirement, namespace: string): boolean {
  const services = expected.children.filter((child) => child.kind === 'Service' && child.namespace === namespace);
  if (object.apiVersion === 'v1' && object.kind === 'Endpoints') return object.metadata.labels?.['endpoints.kubernetes.io/managed-by'] === 'endpoint-controller'
    && services.some((service) => service.name === object.metadata.name) && !(object.subsets as unknown[] | undefined)?.length;
  return object.apiVersion === 'discovery.k8s.io/v1' && object.kind === 'EndpointSlice' && !(object.endpoints as unknown[] | undefined)?.length
    && object.metadata.ownerReferences?.some((owner) => owner.apiVersion === 'v1' && owner.kind === 'Service' && owner.controller === true && services.some((service) => service.uid === owner.uid && service.name === owner.name)) === true;
}

/** 每次删除前重新列全量；列表失败、超过上限或卷尚在，均不把未知解释成空。 */
export async function inspectNamespaceRetirement(k8s: K8sClient, name: string, expected: NamespaceRetirement, systemNamespace: string, signal?: AbortSignal): Promise<K8sObject | undefined> {
  if (name === systemNamespace || name === 'default' || name.startsWith('kube-')) throw precondition('系统命名空间不能在这里删除');
  const namespace = await k8s.get(Resources.Namespace!, name, undefined, signal);
  if (!namespace) return undefined;
  if (namespace.metadata.uid !== expected.uid) throw conflict('命名空间已被同名新实例替换，停止删除');
  if (!k8s.namespacedResources) throw precondition('集群客户端不支持完整资源发现，不能删除命名空间');
  const refs = await k8s.namespacedResources(signal), blockers: string[] = [];
  let count = 0;
  for (const ref of refs) {
    let cursor = '';
    do {
      signal?.throwIfAborted();
      const page = await k8s.listPage(ref, name, { limit: 200, ...(cursor ? { continue: cursor } : {}), ...(signal ? { signal } : {}) });
      count += page.items.length;
      if (count > 10000 || (page.continue && page.continue === cursor)) throw precondition('命名空间资源盘点超过上限或分页未推进，停止删除');
      for (const object of page.items) {
        const allowed = ((object.apiVersion === 'v1' && ['Service', 'ResourceQuota'].includes(object.kind)) || (object.apiVersion === 'networking.k8s.io/v1' && object.kind === 'NetworkPolicy')) && expected.children.some((child) => child.kind === object.kind && child.name === object.metadata.name && child.uid === object.metadata.uid && child.namespace === name);
        if (!allowed && !automatic(object) && !idleEndpoints(object, expected, name)) blockers.push(`${object.kind}/${object.metadata.name}`);
      }
      cursor = page.continue;
    } while (cursor);
  }
  if (blockers.length) throw precondition(`请先处理命名空间内的资源：${blockers.slice(0, 20).join('、')}${blockers.length > 20 ? `（共 ${blockers.length} 项）` : ''}`);
  return namespace;
}

export async function removeRetiredNamespace(k8s: K8sClient, name: string, expected: NamespaceRetirement, systemNamespace: string, signal?: AbortSignal): Promise<void> {
  const namespace = await inspectNamespaceRetirement(k8s, name, expected, systemNamespace, signal);
  if (!namespace || namespace.metadata.deletionTimestamp) return;
  signal?.throwIfAborted();
  await k8s.delete(Resources.Namespace!, name, undefined, { preconditions: { uid: expected.uid, ...(namespace.metadata.resourceVersion ? { resourceVersion: namespace.metadata.resourceVersion } : {}) } });
}
