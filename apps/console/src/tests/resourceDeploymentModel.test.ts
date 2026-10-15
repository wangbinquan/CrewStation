import { expect, test } from 'bun:test';
import { buildDeploymentGraph } from '../features/project-resources/model/deploymentGraph';
import { deploymentProjection, DEPLOYMENT_PAGE_SIZE } from '../features/project-resources/model/deploymentProjection';
import { parseCenterSearch } from '../features/project-resources/model/workspace';
import { deploymentFixture, deploymentT as t, physicalResource } from './resourceDeploymentFixture';
import { resourceRecord } from './resourceRecordFixture';
import { resourceNodeFixture } from './resourceCenterFixture';
import { physicalWorkloadOwner } from '../shared/topology/physicalIdentity';

test('replicas aggregate by immutable owner identity while two slots retain one shared database and object space', () => {
  const f = deploymentFixture(), before = JSON.stringify(f), graph = buildDeploymentGraph(f.input, f.original(), f.snapshot, t);
  expect(graph.objects.get('deployment:slot-prod')!.members.map((n) => n.id)).toEqual(['deploy-prod', 'pod-prod-1', 'pod-prod-2']);
  expect(graph.objects.get('deployment:slot-preview')!.members).toHaveLength(3);
  const projection = deploymentProjection(graph, 'services', {}, t);
  expect(projection.topology.nodes.filter((n) => n.kind === 'database').map((n) => n.id)).toEqual(['deployment:db:production']);
  expect(projection.topology.nodes.filter((n) => n.kind === 'object-space').map((n) => n.id)).toEqual(['deployment:shared-space']);
  expect(projection.topology.nodes.find((n) => n.id === 'deployment:slot-prod')!.box).toBe('namespace');
  expect(projection.topology.nodes.find((n) => n.kind === 'database')!.box).toBeUndefined();
  expect(graph.relations.some((e) => e.from === e.to && e.sourceId === 'deploy-prod' && e.targetId === 'pod-prod-1')).toBe(true);
  expect(JSON.stringify(f)).toBe(before);
});

test('only release declarations create API and event dependencies; unconsumed grants and proposed requests remain in the catalog', () => {
  const f = deploymentFixture(), graph = buildDeploymentGraph(f.input, f.original(), f.snapshot, t), ids = [...graph.objects.keys()];
  expect(ids).toContain('deployment:dependency:api-declared'); expect(ids).toContain('deployment:dependency:event-declared');
  expect(ids).not.toContain('deployment:dependency:api-unused'); expect(graph.usedIds.has('api-unused')).toBe(false);
  expect(graph.relations).toContainEqual(expect.objectContaining({ from: 'deployment:dependency:event-declared', to: 'deployment:slot-prod', kind: 'push', evidence: 'configured' }));
  expect(graph.relations).toContainEqual(expect.objectContaining({ from: 'deployment:slot-prod', to: 'deployment:dependency:api-declared', kind: 'dial' }));
  expect(graph.objects.get('deployment:slot-prod')!.permissions.some((n) => n.id === 'node-078')).toBe(true);
  expect(graph.objects.get('deployment:slot-preview')!.permissions.some((n) => n.id === 'api-declared')).toBe(false);
});

test('different tasks keep their storage and executions separate; task ancestry never creates physical mount edges', () => {
  const f = deploymentFixture(), graph = buildDeploymentGraph(f.input, f.original(), f.snapshot, t);
  for (const view of ['development', 'business'] as const) {
    const p = deploymentProjection(graph, view, {}, t), other = view === 'development' ? 'business' : 'development';
    expect(p.topology.nodes.some((n) => n.id === `deployment:workspace-${view}`)).toBe(true);
    expect(p.topology.nodes.some((n) => n.id === `deployment:volume-${other}`)).toBe(false);
    expect(p.topology.edges.some((e) => e.kind === 'mounts')).toBe(false);
  }
});

test('same names and namespace do not bridge a replacement UID or invent resource permissions', () => {
  const f = deploymentFixture();
  f.input.resources = [...f.input.resources, physicalResource('replaced-deployment', 'Deployment', { name: 'deploy-prod', slotRole: 'prod' })];
  const graph = buildDeploymentGraph(f.input, f.original(), f.snapshot, t), replacement = graph.objects.get('deployment:replaced-deployment')!;
  expect(replacement.members).toHaveLength(1); expect(replacement.permissions).toEqual([]);
  expect(graph.unmapped.map((n) => n.id)).toContain('replaced-deployment');
});

test('pagination exposes every task without claiming that a partial canvas contains the whole project', () => {
  const f = deploymentFixture();
  f.input.records.push(...Array.from({ length: 65 }, (_, i) => resourceRecord({ id: `business-${i}`, kind: 'business-workspace', purpose: 'business-workspace' })));
  const graph = buildDeploymentGraph(f.input, f.original(), f.snapshot, t), shown = new Set<string>();
  const first = deploymentProjection(graph, 'business', {}, t);
  expect(first.count).toBe(68); expect(first.topology.nodes).toHaveLength(DEPLOYMENT_PAGE_SIZE); expect(first.topology.complete).toBe(false);
  for (let page = 1; page <= first.pages; page++) for (const node of deploymentProjection(graph, 'business', { page }, t).topology.nodes) shown.add(node.id);
  expect(shown.size).toBe(first.count); expect(deploymentProjection(graph, 'business', { page: 999 }, t).page).toBe(first.pages);
  expect(parseCenterSearch({ perspective: '__proto__', page: -1 })).toMatchObject({ perspective: undefined, page: undefined });
});

test('missing source completeness stays unknown and filters select linked permissions without altering the global catalog', () => {
  const f = deploymentFixture(); f.input.snapshot = { ...f.input.snapshot, complete: false, incompleteReason: 'database unavailable' };
  const graph = buildDeploymentGraph(f.input, f.original(), f.snapshot, t), p = deploymentProjection(graph, 'services', { q: 'node-078' }, t);
  expect(p.topology.complete).toBe(false); expect(p.topology.incompleteReason).toContain('database unavailable');
  expect(p.topology.nodes.map((n) => n.id)).toEqual(['deployment:route:prod', 'deployment:slot-prod', 'deployment:dependency:event-declared']);
  expect(f.snapshot.nodes.some((n) => n.id === 'api-unused')).toBe(true);
  expect(deploymentProjection(graph, 'delivery', {}, t).count).toBe(0);
});

test('builds without a Pod remain visible and pinned releases precede their jobs without borrowing service permissions', () => {
  const f = deploymentFixture(), job = resourceRecord({ id: 'pending-build', kind: 'build-job', phase: 'pending', display: { releaseId: 'release-preview' } });
  f.input.records.push(job);
  f.snapshot.nodes.push(resourceNodeFixture('resource:pending-build', { resourceId: job.id, resourceType: 'build-job', kind: 'resource' }));
  const graph = buildDeploymentGraph(f.input, f.original(), f.snapshot, t), p = deploymentProjection(graph, 'delivery', {}, t);
  expect(p.topology.nodes.map((node) => node.id)).toEqual(['deployment:pending-build', 'deployment:release:release-preview']);
  expect(p.topology.nodes.find((node) => node.id === 'deployment:pending-build')!.status).toBe('pending');
  expect(p.topology.nodes.find((node) => node.id === 'deployment:pending-build')!.box).toBeUndefined();
  expect(p.topology.edges).toContainEqual(expect.objectContaining({ from: 'deployment:release:release-preview', to: 'deployment:pending-build', kind: 'owns', evidence: 'configured' }));
  expect(p.topology.nodes.some((node) => node.title === 'Declared API')).toBe(false);
});

test('active database bindings link their exact consumer and shared database; pending bindings create no running relationship', () => {
  const f = deploymentFixture(), task = 'resource:workspace-business', database = 'resource:database-production';
  f.snapshot.nodes.push(resourceNodeFixture('binding', { resourceType: 'data-binding', resourceId: 'binding', state: 'active' }));
  f.snapshot.edges.push(f.edge(task, 'binding', 'grants', 'observed'), f.edge('binding', database, 'uses', 'observed'));
  let graph = buildDeploymentGraph(f.input, f.original(), f.snapshot, t);
  expect(deploymentProjection(graph, 'business', {}, t).topology.edges).toContainEqual(expect.objectContaining({ from: 'deployment:workspace-business', to: 'deployment:db:production', kind: 'uses', evidence: 'observed' }));
  f.snapshot.edges.at(-2)!.state = 'proposed'; graph = buildDeploymentGraph(f.input, f.original(), f.snapshot, t);
  expect(deploymentProjection(graph, 'business', {}, t).topology.nodes.some((node) => node.id === 'deployment:db:production')).toBe(false);
});

test('immutable image versions link back to their authorized catalog without creating deployment instances', () => {
  const f = deploymentFixture();
  f.snapshot.nodes.push(resourceNodeFixture('image-version:version-1', { resourceType: 'runtime-image-version' }), resourceNodeFixture('image-catalog', { resourceType: 'runtime-image' }));
  f.snapshot.edges.push(f.edge('release:release-prod', 'image-version:version-1'), f.edge('image-catalog', 'image-version:version-1', 'owns'));
  const graph = buildDeploymentGraph(f.input, f.original(), f.snapshot, t);
  expect(graph.objects.get('deployment:slot-prod')!.permissions.map((node) => node.id)).toContain('image-catalog');
  expect([...graph.objects.values()].some((object) => object.node.id.includes('image-catalog'))).toBe(false);
});

test('physical identity follows replica-set owner UIDs and refuses ambiguous, cyclic or missing ownership', () => {
  const deployment = physicalResource('deployment', 'Deployment'), replica = physicalResource('replica', 'ReplicaSet', { owners: [{ kind: 'Deployment', name: deployment.name, uid: deployment.uid }] });
  const pod = physicalResource('pod', 'Pod', { owners: [{ kind: replica.kind, name: replica.name, uid: replica.uid }] });
  expect(physicalWorkloadOwner(pod, [pod, replica, deployment])?.uid).toBe('deployment');
  expect(physicalWorkloadOwner(pod, [pod, deployment])).toBeUndefined();
  const other = physicalResource('other', 'ReplicaSet'); pod.owners.push({ kind: other.kind, name: other.name, uid: other.uid });
  expect(physicalWorkloadOwner(pod, [pod, replica, deployment, other])).toBeUndefined();
  pod.owners.pop(); replica.owners = [{ kind: 'Pod', name: pod.name, uid: pod.uid }];
  expect(physicalWorkloadOwner(pod, [pod, replica])).toBeUndefined();
});
