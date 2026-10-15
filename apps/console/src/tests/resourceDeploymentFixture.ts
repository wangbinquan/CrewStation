import type { ClusterResource, ProjectResourceEdge } from '@crewstation/contracts';
import type { ProjectTopologyInput } from '../shared/topology/projectTopology';
import { buildProjectTopology } from '../shared/topology/projectTopology';
import { translate } from '../shared/lib/i18n';
import { messages as resourceMessages } from '../features/project-resources/i18n/zh-CN';
import { messages as appMessages } from '../app/i18n/zh-CN';
import { messages as clusterMessages } from '../features/cluster/i18n/zh-CN';
import { resourceRecord } from './resourceRecordFixture';
import { centerProject, centerSnapshot, resourceCenterFixture, resourceNodeFixture } from './resourceCenterFixture';

export const deploymentT = (key: string, values?: Record<string, string | number>) => translate({ ...appMessages, ...clusterMessages, ...resourceMessages }, key, values);
export const deploymentTime = '2026-10-15T10:00:00.000Z';
export const physicalResource = (id: string, kind: string, patch: Partial<ClusterResource> = {}): ClusterResource => ({
  resourceId: `physical-${id}`, apiVersion: 'v1', kind, uid: id, name: id, namespace: 'cs-resource-center', resourceVersion: '1', revision: '1', observedAt: deploymentTime,
  view: kind === 'Pod' ? 'pods' : kind === 'PersistentVolumeClaim' ? 'storage' : 'workloads', ownership: { scope: 'project', projectId: centerProject, projectName: '资源中心验收', slug: 'resource-center', projectKind: 'DigitalWorker', archived: false },
  purpose: 'digital-worker-service', phase: kind === 'PersistentVolumeClaim' ? 'Bound' : 'Running', ready: true, abnormal: false, reason: '', topLevel: kind !== 'Pod', standalone: false, restarts: 0, labels: {}, owners: [], references: [], containers: [], facts: {}, availableActions: [], ...patch,
});
export function deploymentFixture() {
  const snapshot = centerSnapshot(), input: ProjectTopologyInput = {
    project: { id: centerProject, name: snapshot.projectName, namespace: snapshot.namespace, kind: 'DigitalWorker' },
    resources: ['prod', 'preview'].flatMap((role) => [physicalResource(`deploy-${role}`, 'Deployment', { slotRole: role as 'prod', releaseId: `release-${role}`, desired: 2, readyReplicas: 2 }), ...[1, 2].map((i) => physicalResource(`pod-${role}-${i}`, 'Pod', { slotRole: role as 'prod', owners: [{ uid: `deploy-${role}`, kind: 'Deployment', name: `deploy-${role}` }], releaseId: `release-${role}` }))]),
    slots: ['prod', 'preview'].map((role) => ({ name: role as 'prod', active: role === 'prod', tag: 'v1.0', state: 'ready', host: `${role}.test`, replicas: 2, readyReplicas: 2, commitSha: 'a'.repeat(40), releaseId: `release-${role}` as never })),
    dataResources: ['production', 'development'].map((env) => ({ id: `database-${env}`, projectId: snapshot.projectId, kind: 'postgres', env: env as 'production', plan: 'db-small', state: 'ready', envVar: 'CS_DATABASE_URL', createdAt: deploymentTime })),
    snapshot: { id: 'runtime-snapshot', observedAt: deploymentTime, complete: true },
    records: [],
  };
  const records = ['prod', 'preview'].map((role) => resourceRecord({ id: `slot-${role}`, kind: 'service-slot', display: { role, releaseId: `release-${role}`, objectStorage: 'true', serviceId: 'service-1' }, children: input.resources.filter((r) => r.slotRole === role).map((r) => ({ kind: r.kind, name: r.name, uid: r.uid, namespace: r.namespace, phase: r.phase, ready: true })) }));
  records.push(resourceRecord({ id: 'shared-space', kind: 'object-space', display: { env: 'production', serviceId: 'service-1' } }));
  for (const purpose of ['development', 'business']) {
    records.push(resourceRecord({ id: `workspace-${purpose}`, kind: purpose === 'development' ? 'dev-workspace' : 'business-workspace', purpose: `${purpose}-workspace` as 'development-workspace' }), resourceRecord({ id: `agent-${purpose}`, kind: 'agent-execution', purpose: purpose === 'development' ? 'development-agent' : 'business-subtask', parentId: `workspace-${purpose}` }), resourceRecord({ id: `volume-${purpose}`, kind: 'volume', parentId: `workspace-${purpose}`, children: [{ kind: 'PersistentVolumeClaim', uid: `pvc-${purpose}`, name: `pvc-${purpose}`, namespace: snapshot.namespace, phase: 'Bound', ready: true }] }));
  }
  const runtime = { ...input, records };
  snapshot.nodes.push(...records.map((r) => resourceNodeFixture(`resource:${r.id}`, { resourceId: r.id, resourceType: r.kind, kind: 'resource', state: r.phase, source: 'observed' })), ...input.dataResources.map((d) => resourceNodeFixture(`resource:${d.id}`, { resourceId: d.id, resourceType: 'database', category: 'data', environment: d.env })), ...['prod', 'preview'].map((r) => resourceNodeFixture(`release:release-${r}`, { resourceId: `release-${r}`, resourceType: 'release', kind: 'resource' })), resourceNodeFixture('api-declared', { resourceType: 'api-operation', name: 'Declared API' }), resourceNodeFixture('api-unused', { resourceType: 'api-operation', name: 'Unused API' }), resourceNodeFixture('event-declared', { resourceType: 'event-type', name: 'Declared event' }));
  const edge = (sourceId: string, targetId: string, relation: ProjectResourceEdge['relation'] = 'uses', state: ProjectResourceEdge['state'] = 'configured'): ProjectResourceEdge => ({ id: `${sourceId}:${targetId}`, sourceId, targetId, relation, state, label: relation });
  snapshot.edges = [edge('resource:slot-prod', 'release:release-prod'), edge('resource:slot-preview', 'release:release-preview'), edge('release:release-prod', 'api-declared', 'calls'), edge('event-declared', 'release:release-prod', 'pushes'), edge('release:release-prod', 'api-unused', 'calls', 'proposed'), edge('resource:workspace-development', 'execution-limit', 'consumes-quota', 'observed'), ...snapshot.nodes.filter((n) => n.id.startsWith('node-')).map((n) => edge('release:release-prod', n.id))];
  return { input: runtime, snapshot, edge, original: () => buildProjectTopology(runtime, deploymentT) };
}

export function resourceDeploymentFixture(role: 'admin' | 'developer' | 'owner' = 'owner') {
  const fixture = resourceCenterFixture(role), deployment = deploymentFixture(), inner = globalThis.fetch;
  deployment.snapshot.role = role; deployment.snapshot.nodes[0] = fixture.state.snapshot.nodes[0]!;
  fixture.state.snapshot = deployment.snapshot;
  const errors = { inventory: 0, slots: 0 }, at = deploymentTime;
  globalThis.fetch = (async (raw, init) => {
    const path = new URL(String(raw), 'http://localhost').pathname;
    if (path.endsWith('/cluster-resources')) return errors.inventory ? Response.json({ error: 'unavailable', message: 'inventory unavailable' }, { status: errors.inventory }) : Response.json({ snapshotId: 'runtime-snapshot', observedAt: at, complete: deployment.input.snapshot.complete, sources: [], truncated: false, items: deployment.input.resources });
    if (path.endsWith('/slots')) return errors.slots ? Response.json({ error: 'unavailable', message: 'slots unavailable' }, { status: errors.slots }) : Response.json({ items: deployment.input.slots });
    if (path.endsWith('/dev-session')) return Response.json({ error: 'not_found', message: 'No workspace' }, { status: 404 });
    if (path.endsWith('/data/resources')) return Response.json({ items: deployment.input.dataResources });
    if (path === `/v1/projects/${centerProject}/resources`) return Response.json({ items: deployment.input.records, counts: {}, cursor: 0 });
    return inner(raw, init);
  }) as typeof fetch;
  return { ...fixture, ...deployment, errors };
}
