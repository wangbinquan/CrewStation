import type { ProjectResourceSnapshot } from '@crewstation/contracts';
import type { Translate } from '../../../shared/lib/useT';
import type { ProjectTopologyInput } from '../../../shared/topology/projectTopology';
import type { Topology } from '../../../shared/ui/topology/topologyModel';
import { worstStatus } from '../../../shared/ui/topology/topologyModel';
import { deploymentIdentity } from './deploymentIdentity';
import { appendDeploymentDependencies } from './deploymentDependencies';
import type { DeploymentGraph, DeploymentObject, DeploymentRelation, DeploymentView } from './deploymentTypes';
export { DEPLOYMENT_VIEWS } from './deploymentTypes';
export type { DeploymentGraph, DeploymentObject, DeploymentRelation, DeploymentView } from './deploymentTypes';

const bandView = (band: string): DeploymentView | undefined => band.startsWith('slot:') ? 'services' : band === 'dev' ? 'development' : band === 'business' ? 'business' : band === 'jobs' ? 'delivery' : undefined;
const dependencyKinds = new Set(['api-operation', 'event-type', 'event-subscription']);

/** Permission traversal follows explicit declarations only, never project-wide ownership. */
function permissions(anchors: string[], snapshot: ProjectResourceSnapshot) {
  const ids = new Set(anchors), queue = [...ids], rows = new Map(snapshot.nodes.map((node) => [node.id, node]));
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    for (const edge of snapshot.edges) {
      if (edge.state === 'proposed') continue;
      const next = edge.sourceId === id && ['uses', 'calls', 'consumes-quota', 'grants'].includes(edge.relation) ? edge.targetId
        : edge.targetId === id && (edge.relation === 'pushes' || edge.relation === 'grants' && rows.get(edge.sourceId)?.resourceType === 'object-plan' || edge.relation === 'owns' && rows.get(id)?.resourceType === 'runtime-image-version') ? edge.sourceId : undefined;
      if (next && rows.has(next) && !ids.has(next)) { ids.add(next); queue.push(next); }
    }
  }
  return snapshot.nodes.filter((node) => ids.has(node.id) && node.kind !== 'request');
}

function runtimeObjects(input: ProjectTopologyInput, original: Topology, snapshot: ProjectResourceSnapshot, t: Translate) {
  const objects = new Map<string, DeploymentObject>(), aliases = new Map<string, string>();
  for (const member of original.nodes) {
    const identity = deploymentIdentity(member, input, snapshot), id = `deployment:${identity.group}`, view = bandView(member.band);
    let object = objects.get(id);
    if (!object) {
      object = { node: { ...member, id }, members: [], anchors: [], permissions: [], views: new Set(), namespace: identity.namespace };
      objects.set(id, object);
    }
    object.members.push(member); object.anchors.push(...identity.anchors); object.namespace = object.namespace && identity.namespace;
    if (view) object.views.add(view);
    aliases.set(member.id, id);
  }
  for (const object of objects.values()) {
    const representative = object.members.find((m) => m.kind === 'workload' || m.kind === 'job') ?? object.members[0]!;
    object.anchors = [...new Set(object.anchors)]; object.permissions = permissions(object.anchors, snapshot);
    object.node = { ...representative, id: object.node.id, status: worstStatus(object.members), statusText: object.members.find((m) => m.status === worstStatus(object.members))?.statusText,
      subtitle: object.members.length > 1 ? t('resourceCenter.deployment.instances', { count: object.members.length }) : representative.subtitle,
      counts: [[t('resourceCenter.deployment.permissions'), String(object.permissions.length)]] };
  }
  return { objects, aliases };
}

function declaredDependencies(objects: Map<string, DeploymentObject>, snapshot: ProjectResourceSnapshot, t: Translate, relations: DeploymentRelation[]) {
  for (const consumer of [...objects.values()]) {
    for (const resource of consumer.permissions.filter((p) => dependencyKinds.has(p.resourceType))) {
      const id = `deployment:dependency:${resource.id}`;
      let dependency = objects.get(id);
      if (!dependency) {
        dependency = { node: { id, title: resource.name, kind: 'external', semantic: 'external', status: resource.stale ? 'unknown' : resource.access === 'owned' ? 'ready' : 'pending', statusText: t('resourceCenter.evidence.configured'), lane: 3, band: 'architecture' }, members: [], anchors: [resource.id], permissions: [resource], views: new Set(), namespace: false };
        objects.set(id, dependency);
      }
      for (const view of consumer.views) dependency.views.add(view);
      for (const edge of snapshot.edges.filter((e) => e.state !== 'proposed' && (e.targetId === resource.id && e.relation === 'calls' && consumer.anchors.includes(e.sourceId) || e.sourceId === resource.id && e.relation === 'pushes' && consumer.anchors.includes(e.targetId)))) {
        relations.push({ from: edge.relation === 'pushes' ? id : consumer.node.id, to: edge.relation === 'pushes' ? consumer.node.id : id, kind: edge.relation === 'pushes' ? 'push' : 'dial', evidence: edge.state, sourceId: edge.sourceId, targetId: edge.targetId, label: t(edge.relation === 'pushes' ? 'resourceCenter.deployment.eventSubscription' : 'resourceCenter.deployment.apiCall') });
      }
    }
  }
}

export function buildDeploymentGraph(input: ProjectTopologyInput, original: Topology, snapshot: ProjectResourceSnapshot, t: Translate): DeploymentGraph {
  const { objects, aliases } = runtimeObjects(input, original, snapshot, t);
  const relations: DeploymentRelation[] = original.edges.flatMap((edge) => {
    const from = aliases.get(edge.from), to = aliases.get(edge.to);
    return from && to ? [{ ...edge, from, to, sourceId: edge.from, targetId: edge.to }] : [];
  });
  // Only data dependencies inherit their consumers' views. No task or execution crosses views.
  for (let pass = 0; pass < 2; pass++) for (const edge of relations) {
    const from = objects.get(edge.from)!, to = objects.get(edge.to)!;
    if (['database', 'object-space', 'volume'].includes(to.node.kind)) for (const view of from.views) to.views.add(view);
  }
  appendDeploymentDependencies(objects, snapshot, relations, t);
  declaredDependencies(objects, snapshot, t, relations);
  const usedIds = new Set([...objects.values()].flatMap((object) => object.permissions.map((p) => p.id)));
  return { objects, relations, original: { ...original, complete: original.complete && snapshot.complete }, usedIds, unmapped: [...objects.values()].filter((object) => !object.views.size || !object.anchors.length && object.node.kind !== 'route').flatMap((object) => object.members) };
}
