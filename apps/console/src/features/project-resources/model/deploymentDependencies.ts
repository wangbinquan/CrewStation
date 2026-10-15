import type { ProjectResourceSnapshot } from '@crewstation/contracts';
import type { Translate } from '../../../shared/lib/useT';
import type { DeploymentObject, DeploymentRelation } from './deploymentTypes';

/** Release and active data-binding relationships retain the original identities and evidence. */
export function appendDeploymentDependencies(objects: Map<string, DeploymentObject>, snapshot: ProjectResourceSnapshot, relations: DeploymentRelation[], t: Translate) {
  const anchors = new Map<string, string[]>();
  for (const object of objects.values()) for (const id of object.anchors) anchors.set(id, [...anchors.get(id) ?? [], object.node.id]);
  for (const object of [...objects.values()]) {
    if (object.views.has('delivery')) for (const resource of object.permissions.filter((node) => node.resourceType === 'release')) {
      const id = `deployment:release:${resource.resourceId}`, existing = objects.get(id);
      if (!existing) objects.set(id, { node: { id, kind: 'summary', semantic: 'build', title: resource.name, subtitle: t('resourceCenter.deployment.release'), status: resource.stale ? 'unknown' : 'ready', lane: 0, band: 'architecture' }, members: [], anchors: [resource.id], permissions: [resource], views: new Set(['delivery']), namespace: false });
      relations.push({ from: id, to: object.node.id, sourceId: resource.id, targetId: object.anchors.find((anchor) => anchor.startsWith('resource:')) ?? object.members[0]!.id, kind: 'owns', evidence: 'configured', label: t('resourceCenter.deployment.releaseJob') });
    }
    for (const binding of object.permissions.filter((node) => node.resourceType === 'data-binding')) {
      const granted = snapshot.edges.find((edge) => object.anchors.includes(edge.sourceId) && edge.targetId === binding.id && edge.relation === 'grants' && edge.state === 'observed');
      if (!granted) continue;
      for (const access of snapshot.edges.filter((edge) => edge.sourceId === binding.id && edge.relation === 'uses' && edge.state === 'observed')) for (const target of anchors.get(access.targetId) ?? []) {
        relations.push({ from: object.node.id, to: target, sourceId: granted.sourceId, targetId: access.targetId, kind: 'uses', evidence: 'observed', label: access.label });
        for (const view of object.views) objects.get(target)!.views.add(view);
      }
    }
  }
}
