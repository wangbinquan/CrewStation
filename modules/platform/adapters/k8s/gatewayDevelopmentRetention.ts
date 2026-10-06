import { ServiceIdSchema, TaskIdSchema } from '@crewstation/contracts';
import type { ProjectDeletionTarget } from '@crewstation/contracts';
import { Resources } from '@crewstation/k8s';
import type { K8sClient, K8sObject, ResourceRef } from '@crewstation/k8s';
import { jsonHash, precondition } from '@crewstation/kernel';
import { posix } from 'node:path';
import type { GatewayDevelopmentBaseline, GatewayRetentionSources } from '../../ports/deletion/gatewayRetention';
import { inspectDeletionCurrentAssets } from './deletionCurrentAssets';

async function allObjects(k8s: K8sClient, resource: ResourceRef) {
  const rows: K8sObject[] = [], seen = new Set<string>(); let cursor = '', revision: string | undefined;
  do {
    const page = await k8s.listPage(resource, undefined, { limit: 500, ...(cursor ? { continue: cursor } : {}), signal: AbortSignal.timeout(30_000) });
    if (!page.resourceVersion || revision && revision !== page.resourceVersion || page.continue && seen.has(page.continue) || !Array.isArray(page.items)) throw precondition('当前卷来源完整分页无法核对');
    revision = page.resourceVersion; rows.push(...page.items); cursor = page.continue; if (cursor) seen.add(cursor);
  } while (cursor);
  return rows;
}
function binding(row: K8sObject) {
  return { kind: row.kind, name: row.metadata.name, namespace: row.metadata.namespace, uid: row.metadata.uid,
    labels: row.metadata.labels, annotations: row.metadata.annotations, owners: row.metadata.ownerReferences, spec: row['spec'], deleting: !!row.metadata.deletionTimestamp };
}
function mentions(value: unknown, ids: readonly string[]): boolean {
  return typeof value === 'string' ? ids.some(id => value.includes(id)) : !!value && typeof value === 'object' && Object.entries(value).some(([key, entry]) => mentions(key, ids) || mentions(entry, ids));
}
function physicalVolume(row: K8sObject) {
  const spec = row['spec'] as Record<string, unknown> | undefined;
  const keys = ['hostPath', 'local', 'csi', 'nfs'].filter(key => spec?.[key]);
  if (keys.length !== 1) return undefined;
  const kind = keys[0]!, source = spec![kind] as Record<string, unknown>;
  if (kind === 'hostPath' || kind === 'local') return typeof source['path'] === 'string' && posix.isAbsolute(source['path']) ? jsonHash({ kind: 'node-path', path: posix.normalize(source['path']) }) : undefined;
  if (kind === 'csi') return typeof source['driver'] === 'string' && !!source['driver'] && typeof source['volumeHandle'] === 'string' && !!source['volumeHandle'] ? jsonHash({ kind, driver: source['driver'], handle: source['volumeHandle'] }) : undefined;
  return typeof source['server'] === 'string' && !!source['server'] && typeof source['path'] === 'string' && posix.isAbsolute(source['path']) ? jsonHash({ kind, server: source['server'], path: posix.normalize(source['path']) }) : undefined;
}

/** New current negative disposition only: the absent historical Pod UID remains absent. */
export function gatewayDevelopmentRetention(k8s: K8sClient, sources: GatewayRetentionSources) {
  return async (target: ProjectDeletionTarget, rawId: string, original: { namespace: string; name: string }): Promise<GatewayDevelopmentBaseline | undefined> => {
    const taskId = TaskIdSchema.parse(rawId), tasks = sources.tasks(); if (!tasks) return undefined;
    const [environment, ownership, catalog] = await Promise.all([tasks.getEnvironment(taskId), tasks.originalInfrastructureOwnership('task', taskId), tasks.listClusterTasks()]);
    const matches = catalog.filter(row => row.taskId === taskId), task = matches[0];
    if (matches.length !== 1 || !task?.podUid || !environment || environment.id !== taskId || environment.kind !== 'dev-session' || environment.state !== 'running'
      || task.kind !== environment.kind || task.state !== environment.state || task.projectId !== environment.projectId || task.podName !== environment.podName || task.podName === original.name) return undefined;
    if (!ownership?.complete || ownership.id !== taskId || ownership.scope !== 'project' || ownership.projectIds.length !== 1 || ownership.projectIds[0] !== environment.projectId || environment.projectId === target.id) return undefined;
    const service = await sources.project.resolveServiceById(ServiceIdSchema.parse(environment.serviceId));
    if (!service || service.projectId !== environment.projectId || service.serviceId !== environment.serviceId || service.namespace !== task.namespace || service.namespace !== original.namespace || ['archived', 'deleting'].includes(service.state)) return undefined;
    const { assets, pods } = await inspectDeletionCurrentAssets(k8s, target, { ids: [taskId, taskId.replaceAll('-', ''), task.pvcName],
      pods: [{ namespace: original.namespace, name: original.name, uid: null }, { namespace: task.namespace, name: task.podName, uid: task.podUid }] });
    if (assets.pods?.length !== 1 || assets.pods[0]!.name !== task.podName || assets.pods[0]!.namespace !== task.namespace || assets.pods[0]!.uid !== task.podUid || assets.targetReferences.length) return undefined;
    const mounted = ((pods[0]?.['spec'] as { volumes?: { persistentVolumeClaim?: { claimName?: string } }[] } | undefined)?.volumes ?? []).filter(v => v.persistentVolumeClaim).map(v => v.persistentVolumeClaim!.claimName);
    if (!mounted.length || mounted.some(name => name !== task.pvcName)) return undefined;
    const [claims, volumes] = await Promise.all([allObjects(k8s, Resources.PersistentVolumeClaim!), allObjects(k8s, Resources.PersistentVolume!)]);
    const selectedClaims = claims.filter(row => row.metadata.namespace === task.namespace && row.metadata.name === task.pvcName), claim = selectedClaims[0];
    const spec = claim?.['spec'] as { volumeName?: string } | undefined, selectedVolumes = volumes.filter(row => row.metadata.name === spec?.volumeName), volume = selectedVolumes[0];
    const volumeSpec = volume?.['spec'] as { claimRef?: { namespace?: string; name?: string; uid?: string } } | undefined, ref = volumeSpec?.claimRef;
    if (selectedClaims.length !== 1 || selectedVolumes.length !== 1 || !claim?.metadata.uid || !volume?.metadata.uid || claim.metadata.deletionTimestamp || volume.metadata.deletionTimestamp
      || (claim['status'] as { phase?: string } | undefined)?.phase !== 'Bound' || (volume['status'] as { phase?: string } | undefined)?.phase !== 'Bound'
      || ref?.namespace !== task.namespace || ref.name !== task.pvcName || ref.uid !== claim.metadata.uid || task.pvcUid && task.pvcUid !== claim.metadata.uid) return undefined;
    const physical = physicalVolume(volume), targetIds = [target.id, target.serviceId, target.namespace, target.slug, target.prodHost, target.previewHost, target.serviceHost].filter((id): id is string => !!id);
    if (!physical || mentions([binding(claim), binding(volume)], targetIds) || volumes.some(row => row.metadata.uid !== volume.metadata.uid && physicalVolume(row) === physical)
      || claims.some(row => row.metadata.uid !== claim.metadata.uid && (row['spec'] as { volumeName?: string } | undefined)?.volumeName === volume.metadata.name)) return undefined;
    return { taskId, projectId: environment.projectId, serviceId: service.serviceId, namespace: task.namespace, podName: task.podName, podUid: task.podUid,
      kind: 'dev-session', state: 'running', originalAbsent: true, taskDigest: jsonHash({ ownership, task: { taskId, projectId: task.projectId, namespace: task.namespace, podName: task.podName, podUid: task.podUid,
        pvcName: task.pvcName, kind: task.kind, state: task.state, profile: task.profile, volumeMode: task.volumeMode }, service: { projectId: service.projectId, serviceId: service.serviceId, namespace: service.namespace, identity: service.identity, state: service.state } }),
      volumes: [{ namespace: task.namespace, name: claim.metadata.name, uid: claim.metadata.uid, pvName: volume.metadata.name, pvUid: volume.metadata.uid, digest: jsonHash({ claim: binding(claim), volume: binding(volume) }) }], assets };
  };
}
