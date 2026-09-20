import { createHash } from 'node:crypto';
import type { ClusterPurpose, ClusterResource } from '@crewstation/contracts';
import type { InventoryFacts, ResourceObject, SystemComponent } from './inventory';
import { networkKinds, objectRecord, workloadKinds } from './inventory';
import { resourceGraph, referencesOf } from './resourceGraph';
import { containerDetails, resourceStatus, visibleFacts } from './resourceStatus';
import { resourceCapabilities } from './resourceCapabilities';

export const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(canonical(value)) ?? 'null').digest('hex');
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  return value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : value;
}
export const configRevision = (obj: ResourceObject): string => digest({ uid: obj.metadata.uid, spec: obj.spec, data: obj.data, type: obj.type, owners: obj.metadata.ownerReferences, labels: obj.metadata.labels });

function purposeOf(obj: ResourceObject, fact: InventoryFacts['tasks'][number] | undefined, projectKind: string | undefined, system: SystemComponent | undefined): ClusterPurpose {
  if (fact) {
    if (fact.kind === 'profile-test') return 'profile-test';
    if (fact.parentTaskId) return fact.purpose === 'subtask' ? 'business-subtask' : fact.purpose === 'agent' ? 'development-agent' : 'development-cli';
    return fact.kind === 'dev-session' ? 'development-workspace' : 'business-workspace';
  }
  const labels = obj.metadata.labels ?? {}, component = labels['app.kubernetes.io/component'];
  if (labels['crewstation.io/task']) return 'unknown';
  if (component === 'build' || component === 'migration') return component;
  if (labels['crewstation.io/workload'] === 'service') return projectKind === 'APIProxy' ? 'api-proxy' : projectKind === 'EventProducer' ? 'event-producer' : projectKind === 'DigitalWorker' ? 'digital-worker-service' : 'unknown';
  return system?.purpose ?? 'unknown';
}

export function projectResources(objects: ResourceObject[], facts: InventoryFacts, systemNamespace: string, catalog: SystemComponent[], observedAt: string, identities: ReadonlyMap<string, string>): ClusterResource[] {
  const resourceId = (obj: ResourceObject): string => {
    const id = identities.get(obj.metadata.uid!);
    if (!id) throw new Error(`Unregistered cluster resource UID: ${obj.metadata.uid}`);
    return id;
  };
  const graph = resourceGraph(objects, facts, systemNamespace, catalog), rows: ClusterResource[] = [];
  for (const obj of objects) {
    const ownership = graph.ownership(obj);
    if (!ownership || !obj.metadata.uid) continue;
    const ns = obj.metadata.namespace ?? '', labels = obj.metadata.labels ?? {}, parent = graph.owner(obj);
    const task = obj.kind === 'Pod' ? facts.tasks.find((t) => t.namespace === ns && t.podName === obj.metadata.name && (!!t.podUid && t.podUid === obj.metadata.uid)) : undefined;
    const project = facts.projects.find((p) => p.namespace === ns);
    const slot = facts.releases.find((s) => s.namespace === ns && s.serviceName === labels['crewstation.io/service'] && s.physical === labels['crewstation.io/slot']);
    const containers = containerDetails(obj), system = graph.system.get(obj.metadata.uid);
    const row: ClusterResource = {
      resourceId: resourceId(obj), apiVersion: obj.apiVersion, kind: obj.kind, namespace: ns, name: obj.metadata.name, uid: obj.metadata.uid, resourceVersion: obj.metadata.resourceVersion ?? '', revision: configRevision(obj), observedAt,
      view: obj.kind === 'Pod' ? 'pods' : obj.kind === 'Namespace' ? 'namespaces' : workloadKinds.has(obj.kind) ? 'workloads' : networkKinds.has(obj.kind) ? 'network' : 'storage',
      ownership, purpose: purposeOf(obj, task, project?.kind, system), ...resourceStatus(obj, containers), topLevel: !parent || !(obj.kind === 'ReplicaSet' && parent.kind === 'Deployment' || obj.kind === 'Job' && parent.kind === 'CronJob'), standalone: obj.kind === 'Pod' && !obj.metadata.ownerReferences?.some((owner) => owner.controller),
      ...(obj.metadata.creationTimestamp ? { createdAt: obj.metadata.creationTimestamp } : {}), ...(obj.metadata.deletionTimestamp ? { deletingAt: obj.metadata.deletionTimestamp } : {}), ...(obj.metadata.generation !== undefined ? { generation: obj.metadata.generation } : {}),
      labels, owners: (obj.metadata.ownerReferences ?? []).map((o) => { const found = graph.byUid.get(o.uid); return { kind: o.kind, name: o.name, uid: o.uid, ...(found && found.metadata.namespace === ns && found.kind === o.kind && found.metadata.name === o.name ? { resourceId: resourceId(found) } : {}) }; }),
      references: referencesOf(obj), containers, facts: visibleFacts(obj), availableActions: [],
      ...(task ? { taskId: task.taskId, profile: task.profile, domainRevision: task.revision, ...(task.parentTaskId ? { parentTaskId: task.parentTaskId } : {}), ...(task.agentId ? { agentId: task.agentId } : {}), ...(task.terminalId ? { terminalId: task.terminalId } : {}), ...(task.profileRevision === undefined ? {} : { profileRevision: task.profileRevision }) } : {}),
      ...(slot ? { serviceId: slot.serviceId, physicalSlot: slot.physical, slotRole: slot.role, domainRevision: slot.revision, ...(slot.releaseId ? { releaseId: slot.releaseId } : {}) } : labels['crewstation.io/release'] ? { releaseId: labels['crewstation.io/release'] } : {}),
    };
    if (obj.kind === 'Pod' && labels['crewstation.io/task'] && !task) row.facts.identityReason = '没有匹配此 Pod UID 的任务实例记录；旧工作区需要 Runner 重新连接后绑定实例';
    if (task?.kind === 'profile-test' && task.profileTestId) row.facts.profileTestId = task.profileTestId;
    if (slot) for (const [key, v] of Object.entries({ manifestReplicas: slot.manifestReplicas, overrideReplicas: slot.overrideReplicas, maxReplicas: slot.maxReplicas })) if (v !== undefined) row.facts[key] = String(v);
    if (obj.kind === 'HorizontalPodAutoscaler') row.facts.target = JSON.stringify(objectRecord(obj.spec).scaleTargetRef);
    row.availableActions = resourceCapabilities(row, facts, system, objects);
    rows.push(row);
  }
  return rows.sort((a, b) => `${a.namespace}/${a.name}/${a.uid}`.localeCompare(`${b.namespace}/${b.name}/${b.uid}`));
}
