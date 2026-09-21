import type { ClusterResource, ClusterUsage } from '@crewstation/contracts';
import type { MetricsTopology } from './observations';
import type { StorageResult, StorageTarget } from './observations';
import type { ResourceObject } from './inventory';
import { objectArray, objectRecord } from './inventory';
import { emptyDemand, normalized } from './resourceDemand';
import { freshness, gauge, missingMetric } from './metricValues';

function volumeFor(pvc: ResourceObject, volumes: ResourceObject[]) {
  return volumes.find((v) => v.metadata.name === objectRecord(pvc.spec).volumeName && objectRecord(objectRecord(v.spec).claimRef).uid === pvc.metadata.uid && objectRecord(objectRecord(v.spec).claimRef).namespace === pvc.metadata.namespace && objectRecord(objectRecord(v.spec).claimRef).name === pvc.metadata.name);
}
function nativeUsage(pvc: ResourceObject, volume: ResourceObject | undefined, topology: MetricsTopology, summaries: unknown[], now: number) {
  if (!volume) return missingMetric('volumeUsed', 'kubelet-summary', 'Live PV claim UID does not match the PVC');
  const samples = summaries.flatMap((s) => objectArray(objectRecord(s).pods)).flatMap((p) => {
    const pod = topology.pods.find((live) => live.metadata.uid === objectRecord(p.podRef).uid && live.metadata.namespace === pvc.metadata.namespace);
    if (!pod) return [];
    const mounts = objectArray(objectRecord(pod.spec).volumes).filter((v) => objectRecord(v.persistentVolumeClaim).claimName === pvc.metadata.name).map((v) => v.name);
    return objectArray(p.volume).filter((v) => objectRecord(v.pvcRef).name === pvc.metadata.name && objectRecord(v.pvcRef).namespace === pvc.metadata.namespace && mounts.includes(v.name)).map((v) => gauge('volumeUsed', v.usedBytes, v.time, 'kubelet-summary-volume', now));
  }).filter((v) => v.state === 'fresh').sort((a, b) => Date.parse(b.observedAt!) - Date.parse(a.observedAt!));
  const selected = samples[0];
  if (!selected) return missingMetric('volumeUsed', 'kubelet-summary', 'Storage driver did not report PVC used bytes', 'unsupported');
  return new Set(samples.map((v) => v.value)).size > 1 ? { ...selected, reason: 'Multiple mounted observations differ; using the latest source timestamp', reasonCode: 'multiple-observations' } : selected;
}
function matchesNode(node: ResourceObject, expression: Record<string, unknown>): boolean {
  const value = node.metadata.labels?.[String(expression.key)], values = Array.isArray(expression.values) ? expression.values.map(String) : [];
  switch (expression.operator) {
    case 'In': return value !== undefined && values.includes(value);
    case 'NotIn': return value === undefined || !values.includes(value);
    case 'Exists': return value !== undefined;
    case 'DoesNotExist': return value === undefined;
    case 'Gt': return value !== undefined && Number(value) > Number(values[0]);
    case 'Lt': return value !== undefined && Number(value) < Number(values[0]);
    default: return false;
  }
}
export function localStorageTarget(pvc: ResourceObject, resourceId: string, topology: MetricsTopology, root: string): StorageTarget | undefined {
  const volume = volumeFor(pvc, topology.volumes), spec = objectRecord(volume?.spec);
  if (!volume || !root.startsWith('/') || objectRecord(pvc.spec).volumeMode === 'Block') return undefined;
  const path = String(objectRecord(spec.hostPath).path ?? objectRecord(spec.local).path ?? ''), prefix = `${root.replace(/\/+$/, '')}/`;
  if (!path.startsWith(prefix)) return undefined;
  const relativePath = path.slice(prefix.length);
  if (!relativePath || relativePath.split('/').some((p) => !p || p === '.' || p === '..') || relativePath.includes('\0')) return undefined;
  const terms = objectArray(objectRecord(objectRecord(spec.nodeAffinity).required).nodeSelectorTerms);
  const nodes = topology.nodes.filter((n) => terms.some((t) => !objectArray(t.matchFields).length && objectArray(t.matchExpressions).length > 0 && objectArray(t.matchExpressions).every((e) => matchesNode(n, e))));
  if (nodes.length !== 1) return undefined;
  const node = nodes[0]!, probe = topology.pods.find((p) => p.metadata.labels?.app === 'cs-storage-probe' && objectRecord(p.spec).nodeName === node.metadata.name && objectArray(objectRecord(p.status).conditions).some((c) => c.type === 'Ready' && c.status === 'True'));
  return { resourceId, uid: pvc.metadata.uid!, volumeUid: volume.metadata.uid!, node: node.metadata.name, rootId: 'local', relativePath, ...(probe && typeof objectRecord(probe.status).podIP === 'string' ? { address: String(objectRecord(probe.status).podIP) } : {}) };
}
export function storageProjection(pvc: ResourceObject, resource: ClusterResource, topology: MetricsTopology, managed: ClusterResource[], summaries: unknown[], measured: StorageResult[], now: number, root: string): { usage: ClusterUsage; target?: StorageTarget } {
  const spec = objectRecord(pvc.spec), status = objectRecord(pvc.status), errors: string[] = [], volume = volumeFor(pvc, topology.volumes), target = localStorageTarget(pvc, resource.resourceId, topology, root);
  let metric = nativeUsage(pvc, volume, topology, summaries, now);
  const fallback = measured.find((m) => m.uid === pvc.metadata.uid && m.volumeUid === volume?.metadata.uid);
  if (metric.state !== 'fresh' && target) metric = fallback ? freshness(fallback.metric, now, 180_000) : missingMetric('volumeUsed', 'local-path-probe', target.address ? 'Waiting for the first directory measurement' : 'No ready storage probe on the volume node', target.address ? 'warming-up' : 'unavailable');
  const mounts = topology.pods.filter((p) => p.metadata.namespace === pvc.metadata.namespace && objectArray(objectRecord(p.spec).volumes).some((v) => objectRecord(v.persistentVolumeClaim).claimName === pvc.metadata.name)).flatMap((p) => {
    const m = managed.find((r) => r.uid === p.metadata.uid); return m ? [{ resourceId: m.resourceId, name: p.metadata.name, node: String(objectRecord(p.spec).nodeName ?? '') }] : [];
  });
  const usage: ClusterUsage = { resourceId: resource.resourceId, uid: resource.uid, kind: 'PersistentVolumeClaim', namespace: resource.namespace, name: resource.name, scope: resource.ownership.scope, ...(resource.ownership.scope === 'project' ? { projectId: resource.ownership.projectId } : {}), node: target?.node, phase: String(status.phase ?? 'Unknown'), demand: { ...emptyDemand(), errors }, metrics: { volumeUsed: metric, storageRequested: gauge('storageRequested', normalized(objectRecord(spec.resources).requests).storage, new Date(now).toISOString(), 'kubernetes-pvc', now), storageCapacity: gauge('storageCapacity', normalized(status.capacity).storage, new Date(now).toISOString(), 'kubernetes-pvc', now) }, containers: [], storage: { requested: normalized(objectRecord(spec.resources).requests, errors).storage, capacity: normalized(status.capacity, errors).storage, storageClass: String(spec.storageClassName ?? ''), accessModes: Array.isArray(spec.accessModes) ? spec.accessModes.map(String) : [], volumeMode: String(spec.volumeMode ?? 'Filesystem'), mounts, hardQuota: false, volumeName: String(spec.volumeName ?? ''), source: target ? 'local-path (allocated blocks; declaration is not a hard quota)' : 'driver-reported (quota enforcement not verified)' } };
  return { usage, ...(target && metric.source !== 'kubelet-summary-volume' ? { target } : {}) };
}
