import type { ClusterHistoryResource, ClusterInspection, ClusterOperation, ClusterResource, ProjectDeletionTarget } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { InventorySnapshot, MetricsObservation, StorageResult } from './observations';
import { usageSummary } from './capacity';

export interface ClusterProjectScope {
  readonly projectId: string;
  readonly namespace: string;
  readonly serviceId?: string;
  readonly projectKeys?: readonly string[];
  readonly serviceKeys?: readonly string[];
  readonly referenceHashes?: readonly string[];
  readonly resources: readonly { readonly id: string; readonly uid: string }[];
}
export const projectKey = (scope: ClusterProjectScope, id?: string) => !!id && (id === scope.projectId || !!scope.projectKeys?.includes(id));
const serviceKey = (scope: ClusterProjectScope, id: string) => id === scope.serviceId || !!scope.serviceKeys?.includes(id);
export function projectResource(resource: ClusterResource, scope: ClusterProjectScope): boolean {
  return resource.ownership.scope === 'project' ? projectKey(scope, resource.ownership.projectId)
    : resource.ownership.scope === 'unresolved' && scope.resources.some((entry) => entry.id === resource.resourceId && entry.uid === resource.uid);
}
const knownId = (scope: ClusterProjectScope, id: string) => scope.resources.some((entry) => entry.id === id);
const knownUid = (scope: ClusterProjectScope, uid: string) => scope.resources.some((entry) => entry.uid === uid);
const knownPair = (scope: ClusterProjectScope, id: string, uid: string) => scope.resources.some((entry) => entry.id === id && entry.uid === uid);
const referenceKey = (resource: ClusterResource) => resource.namespace + '/' + resource.kind + '/' + resource.name;
const knownReference = (scope: ClusterProjectScope, key: string) => !!scope.referenceHashes?.includes(jsonHash(key));
export function clusterProjectScope(target: ProjectDeletionTarget, snapshots: readonly InventorySnapshot[], histories: readonly ClusterHistoryResource[], retained?: ClusterProjectScope, targets: readonly ClusterResource[] = []): ClusterProjectScope {
  if (retained && (retained.projectId !== target.id || retained.namespace !== target.namespace || retained.serviceId !== target.serviceId)) throw precondition('集群历史清理范围不属于原项目');
  const scope: ClusterProjectScope = { projectId: target.id, namespace: target.namespace, ...(target.serviceId ? { serviceId: target.serviceId } : {}),
    ...(retained?.projectKeys ? { projectKeys: retained.projectKeys } : {}), ...(retained?.serviceKeys ? { serviceKeys: retained.serviceKeys } : {}), resources: retained?.resources ?? [] };
  const entries = [...scope.resources, ...[...snapshots.flatMap((snapshot) => snapshot.resources), ...targets].filter((resource) => projectResource(resource, scope)).map((resource) => ({ id: resource.resourceId, uid: resource.uid })),
    ...histories.filter((history) => projectKey(scope, history.projectId) || history.versions.some((version) => projectKey(scope, version.projectId))).map((history) => ({ id: history.resourceId, uid: history.uid }))];
  const resources = [...new Map(entries.map((entry) => [entry.id, entry])).values()].sort((a, b) => a.id.localeCompare(b.id));
  if (resources.some((entry) => !entry.id || !entry.uid) || entries.some((entry) => resources.find((original) => original.id === entry.id)?.uid !== entry.uid)) throw precondition('集群历史资源身份缺失或同一平台ID对应多个原UID');
  const referenceHashes = [...new Set([...(retained?.referenceHashes ?? []), ...[...snapshots.flatMap((snapshot) => snapshot.resources), ...targets].filter((resource) => projectResource(resource, scope)).map((resource) => jsonHash(referenceKey(resource)))])].sort();
  return { ...scope, resources, referenceHashes };
}
/** Only structured ownership selects content; a matching name never takes over a different project. */
export function withoutProjectSnapshot(input: InventorySnapshot, scope: ClusterProjectScope): InventorySnapshot {
  const otherNamespaceOwner = input.facts.projects.some((project) => project.namespace === scope.namespace && !projectKey(scope, project.projectId));
  const projects = input.facts.projects.filter((project) => !projectKey(scope, project.projectId));
  const serviceIds = new Set(input.facts.projects.filter((project) => projectKey(scope, project.projectId)).flatMap((project) => project.serviceId ? [project.serviceId] : []));
  if (scope.serviceId) serviceIds.add(scope.serviceId);
  const removed = input.resources.filter((resource) => projectResource(resource, scope)), survivors = input.resources.filter((resource) => !projectResource(resource, scope));
  const key = referenceKey;
  const keys = new Set(removed.map(key).filter((value) => !survivors.some((resource) => key(resource) === value)));
  const protectedIds = new Set(survivors.filter((resource) => resource.ownership.scope !== 'unresolved').flatMap((resource) => [resource.resourceId, ...scope.resources.filter((entry) => entry.uid === resource.uid).map((entry) => entry.id)]));
  const protectedReferences = new Set(survivors.filter((resource) => resource.ownership.scope !== 'unresolved').map(key));
  const resources = survivors.map((resource) => ({ ...withoutProjectResourceReferences(resource, scope, protectedIds, protectedReferences), references: resource.references.filter((id) => (!knownId(scope, id) || protectedIds.has(id)) && !keys.has(id) && (!knownReference(scope, id) || protectedReferences.has(id))) }));
  return { ...input, resources, sources: input.sources.filter((source) => source.namespace !== scope.namespace || otherNamespaceOwner), facts: { ...input.facts, projects,
    tasks: input.facts.tasks.filter((task) => !projectKey(scope, task.projectId)), releases: input.facts.releases.filter((release) => !serviceIds.has(release.serviceId) && !serviceKey(scope, release.serviceId)),
    retained: input.facts.retained.filter((reference) => reference.namespace !== scope.namespace || otherNamespaceOwner) } };
}
export function withoutProjectObservation(input: MetricsObservation, scope: ClusterProjectScope): MetricsObservation {
  const otherUids = new Set([...input.usages.filter((usage) => usage.scope === 'system' || usage.scope === 'project' && !projectKey(scope, usage.projectId)).map((usage) => usage.uid),
    ...input.identities.filter((history) => !history.deleted && (history.scope === 'system' || history.scope === 'project' && !projectKey(scope, history.projectId))).map((history) => history.uid)]);
  const usages = input.usages.filter((usage) => !projectKey(scope, usage.projectId) && !(usage.scope === 'unresolved' && knownPair(scope, usage.resourceId, usage.uid) && !otherUids.has(usage.uid)));
  const removedUid = (uid: string) => knownUid(scope, uid) && !otherUids.has(uid);
  const removedId = (id: string) => scope.resources.some((entry) => entry.id === id && removedUid(entry.uid));
  const cleanUsages = usages.map((usage) => ({ ...usage, ...(usage.storage ? { storage: { ...usage.storage, mounts: usage.storage.mounts.filter((mount) => !removedId(mount.resourceId)) } } : {}) }));
  const identities = input.identities.flatMap((history) => {
    const next = withoutProjectHistory(history, scope); return next ? [next] : [];
  });
  const projects = Object.fromEntries(Object.entries(input.capacity.projects).filter(([id]) => !projectKey(scope, id)));
  const counters = Object.fromEntries(Object.entries(input.counters).filter(([key]) => !key.split('/').some(removedUid)));
  const nodes = input.nodes.map((node) => ({ ...node, managedPodIds: node.managedPodIds.filter((id) => !removedId(id)), ...(node.managedPods ? { managedPods: node.managedPods.filter((pod) => !removedId(pod.resourceId)) } : {}) }));
  return { ...input, nodes, usages: cleanUsages, identities, counters, storageTargets: input.storageTargets.filter((target) => !removedUid(target.uid)),
    capacity: { ...input.capacity, projects, managed: usageSummary(cleanUsages, Date.parse(input.at), Date.parse(input.capacity.observedAt)) } };
}
export function withoutProjectHistory(input: ClusterHistoryResource, scope: ClusterProjectScope): ClusterHistoryResource | null {
  const own = projectKey(scope, input.projectId) || input.scope === 'unresolved' && knownPair(scope, input.resourceId, input.uid);
  const versions = input.versions.filter((version) => !projectKey(scope, version.projectId) && !(own && version.scope === 'unresolved'));
  if (!own) return { ...input, versions };
  if (!versions.length) return null;
  // A shared historical identity keeps only the other project's actual versions.
  const latest = versions.at(-1)!;
  const { projectId: _projectId, ...rest } = input;
  return { ...rest, name: latest.name, namespace: latest.namespace, scope: latest.scope, ...(latest.projectId ? { projectId: latest.projectId } : {}),
    firstSeen: versions[0]!.from, lastSeen: latest.to ?? input.lastSeen, versions, deleted: true };
}
export function withoutProjectStorage(input: readonly StorageResult[], scope: ClusterProjectScope): StorageResult[] {
  return input.filter((result) => !knownUid(scope, result.uid));
}
export function projectInspection(input: ClusterInspection, scope: ClusterProjectScope): boolean { return projectResource(input.target, scope); }
export function projectOperation(input: ClusterOperation, scope: ClusterProjectScope): boolean { return projectResource(input.target, scope); }
function withoutProjectResourceReferences(resource: ClusterResource, scope: ClusterProjectScope, protectedIds: ReadonlySet<string> = new Set(), protectedReferences: ReadonlySet<string> = new Set()): ClusterResource {
  return { ...resource, owners: resource.owners.filter((owner) => !knownUid(scope, owner.uid) || owner.resourceId && protectedIds.has(owner.resourceId)), references: resource.references.filter((id) => (!knownId(scope, id) || protectedIds.has(id)) && (!knownReference(scope, id) || protectedReferences.has(id))) };
}
export function withoutProjectInspection(input: ClusterInspection, scope: ClusterProjectScope): ClusterInspection | null {
  return projectInspection(input, scope) ? null : { ...input, target: withoutProjectResourceReferences(input.target, scope), related: input.related.filter((entry) => !knownUid(scope, entry.uid)) };
}
export function withoutProjectOperation(input: ClusterOperation, scope: ClusterProjectScope): ClusterOperation | null {
  if (projectOperation(input, scope)) return null;
  const { after, ...rest } = input;
  return { ...rest, target: withoutProjectResourceReferences(input.target, scope), ...(after && !projectResource(after, scope) ? { after: withoutProjectResourceReferences(after, scope) } : {}) };
}
export function projectContentChanged(before: unknown, after: unknown): boolean { return jsonHash(before) !== jsonHash(after); }
/** Opaque domain detail cannot be declared clean while a structured original project/service reference remains. */
export function hasProjectContentReference(value: unknown, scope: ClusterProjectScope): boolean {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, item]) => typeof item === 'string' && (key === 'projectId' && projectKey(scope, item) || key === 'serviceId' && serviceKey(scope, item))
    || key === scope.projectId || key === scope.serviceId || hasProjectContentReference(item, scope));
}
