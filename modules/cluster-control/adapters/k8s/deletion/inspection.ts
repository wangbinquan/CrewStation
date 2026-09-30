import type { ProjectDeletionInventory, ProjectDeletionTarget } from '@crewstation/contracts';
import type { K8sClient, K8sObject, ResourceRef } from '@crewstation/k8s';
import { Resources } from '@crewstation/k8s';
import { jsonHash, precondition } from '@crewstation/kernel';
import { automaticClusterObject, clusterObjectResource, endpointService } from '../../../domain/deletion/objects';
import type { LedgerObservations } from '../../../ports/ledger';
import type { ClusterDeletionAdmission } from '../../../api/projectDeletion';

const MANAGED = new Set(['Pod', 'PersistentVolumeClaim', 'Secret', 'Service', 'IngressRoute', 'Deployment', 'Job', 'Middleware', 'Namespace', 'ResourceQuota', 'NetworkPolicy']);
export async function fullClusterList(k8s: K8sClient, ref: ResourceRef, namespace: string | undefined, signal: AbortSignal): Promise<K8sObject[]> {
  const objects: K8sObject[] = [], cursors = new Set<string>(); let cursor = '';
  do {
    signal.throwIfAborted();
    const page = await k8s.listPage(ref, namespace, { limit: 200, ...(cursor ? { continue: cursor } : {}), signal });
    if (!Array.isArray(page.items) || cursors.size > 10000 || (page.continue && cursors.has(page.continue))) throw precondition('集群盘点未完整分页，停止清理');
    objects.push(...page.items);
    if (objects.length > 10000) throw precondition('集群盘点未完整分页，停止清理');
    cursor = page.continue; if (cursor) cursors.add(cursor);
  } while (cursor);
  return objects;
}
type Claims = Pick<LedgerObservations, 'claimOf' | 'get'>;
async function owned(ledger: Claims, object: K8sObject, projectId: string, objects: readonly K8sObject[], depth = 0): Promise<boolean> {
  if (depth > 8 || !object.metadata.uid) return false;
  if (MANAGED.has(object.kind)) {
    const id = await ledger.claimOf({ kind: object.kind, namespace: object.metadata.namespace, name: object.metadata.name, uid: object.metadata.uid });
    const record = id && await ledger.get(id);
    if (record && record.projectId === projectId && record.children.some((child) => child.kind === object.kind && child.namespace === object.metadata.namespace && child.name === object.metadata.name && child.uid === object.metadata.uid)) return true;
  }
  if (!['Pod', 'ReplicaSet'].includes(object.kind)) return false;
  const parent = object.metadata.ownerReferences?.find((entry) => entry.controller);
  const source = parent && objects.find((entry) => entry.apiVersion === parent.apiVersion && entry.kind === parent.kind && entry.metadata.name === parent.name && entry.metadata.uid === parent.uid);
  return source ? owned(ledger, source, projectId, objects, depth + 1) : false;
}
export async function inspectProjectCluster(k8s: K8sClient, ledger: Claims, admission: ClusterDeletionAdmission, target: ProjectDeletionTarget, systemNamespace: string): Promise<ProjectDeletionInventory> {
  if (target.namespace === systemNamespace || target.namespace === 'default' || target.namespace.startsWith('kube-')) throw precondition('系统命名空间不属于项目删除范围');
  if (!k8s.namespacedResources) throw precondition('集群来源缺少完整 discovery');
  const signal = AbortSignal.timeout(30_000), refs = await k8s.namespacedResources(signal), objects: K8sObject[] = [];
  const namespace = await k8s.get(Resources.Namespace!, target.namespace, undefined, signal);
  if (namespace) objects.push(namespace);
  for (const ref of refs) {
    if (!ref.namespaced) throw precondition('命名空间 discovery 返回了错误作用域');
    objects.push(...await fullClusterList(k8s, ref, target.namespace, signal));
    if (objects.length > 10000) throw precondition('项目集群盘点超过安全上限，停止清理');
  }
  const volumes = (await fullClusterList(k8s, Resources.PersistentVolume!, undefined, signal)).filter((object) => (object['spec'] as { claimRef?: { namespace?: string } } | undefined)?.claimRef?.namespace === target.namespace);
  const resources = [], blockers: ProjectDeletionInventory['blockers'] = [];
  for (const object of [...objects, ...volumes]) {
    if (automaticClusterObject(object)) continue;
    const service = endpointService(object, objects);
    if (service && await owned(ledger, service, target.id, objects)) continue;
    const claim = object.kind === 'PersistentVolume' && objects.find((entry) => entry.kind === 'PersistentVolumeClaim' && entry.metadata.uid === (object['spec'] as { claimRef?: { uid?: string } }).claimRef?.uid);
    const known = object.kind === 'PersistentVolume' ? admission.ownsVolume ? await admission.ownsVolume(target.id, object) : claim && await owned(ledger, claim, target.id, objects) : await owned(ledger, object, target.id, objects);
    if (!known) blockers.push({ participant: 'cluster-control', code: 'unknown-object', message: `无法证明 ${object.kind}/${object.metadata.name} 归本项目；需核对原归属后重新盘点`, resourceId: object.metadata.name });
    resources.push(clusterObjectResource(object));
  }
  resources.sort((a, b) => a.id.localeCompare(b.id));
  return { participant: 'cluster-control', complete: true, revision: jsonHash(resources), resources, references: [], blockers };
}
