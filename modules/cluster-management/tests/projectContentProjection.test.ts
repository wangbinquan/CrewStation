import { describe, expect, test } from 'bun:test';
import { ProjectDeletionTargetSchema } from '@crewstation/contracts';
import type { ClusterHistoryResource } from '@crewstation/contracts';
import { clusterProjectScope, withoutProjectHistory, withoutProjectInspection, withoutProjectObservation, withoutProjectOperation, withoutProjectSnapshot, withoutProjectStorage } from '../domain/projectDeletion';
import { observeMetrics } from '../application/observeMetrics';
import { projectResources } from '../domain/projection';
import { metricsFixture, metricsTicket } from './metricsFixture';
import { catalog, facts, object, resourceIds } from './inventoryFixture';

const target = ProjectDeletionTargetSchema.parse({ id: facts.projects[0]!.projectId, slug: 'demo', name: 'Demo', namespace: 'cs-demo', serviceId: facts.projects[0]!.serviceId,
  kind: 'DigitalWorker', state: 'active', revision: '1', prodHost: 'demo.cs.localhost', previewHost: 'preview.demo.cs.localhost', serviceHost: 'demo' });
const otherId = '01a0bf5d-8f4b-7178-82e1-9a99060b1193';

describe('project content in shared cluster observations', () => {
  test('removes owned objects, facts and reverse references while preserving other projects and the input', () => {
    const f = metricsFixture(), snapshot = structuredClone(f.inventory), original = structuredClone(snapshot);
    const otherFacts = { ...facts, projects: [{ projectId: otherId, name: 'Other', slug: 'other', namespace: 'cs-other', kind: 'DigitalWorker', state: 'active' }] };
    const other = object('Pod', 'other', 'cs-other');
    const row = projectResources([other], otherFacts, 'crewstation-system', catalog, snapshot.finishedAt, resourceIds([other]))[0]!;
    row.references = [snapshot.resources[0]!.resourceId, 'unrelated-reference'];
    snapshot.resources.push(row); snapshot.facts.projects.push(...otherFacts.projects);
    snapshot.sources = [{ key: 'demo', kind: 'Pod', namespace: 'cs-demo', batchId: '1', resourceVersion: '1', state: 'complete', count: 1 },
      { key: 'other', kind: 'Pod', namespace: 'cs-other', batchId: '2', resourceVersion: '2', state: 'complete', count: 1 }];
    const before = structuredClone(snapshot), scope = clusterProjectScope(target, [snapshot], []), result = withoutProjectSnapshot(snapshot, scope);
    expect(result.resources.filter((resource) => resource.ownership.scope === 'project')).toHaveLength(1);
    expect(result.resources.find((resource) => resource.uid === row.uid)?.references).toEqual(['unrelated-reference']);
    expect(result.facts.projects).toEqual(otherFacts.projects); expect(result.sources.map((source) => source.namespace)).toEqual(['cs-other']);
    expect(original.resources).toEqual(f.inventory.resources); expect(snapshot.resources).toHaveLength(original.resources.length + 1); expect(snapshot).toEqual(before);
  });
  test('uses original ID and UID together for lost ownership and preserves a different project at the same namespace', () => {
    const f = metricsFixture(), scope = clusterProjectScope(target, [f.inventory], []), snapshot = structuredClone(f.inventory);
    const own = snapshot.resources.find((resource) => resource.ownership.scope === 'project')!;
    own.ownership = { scope: 'unresolved', reason: 'project fact unavailable' };
    const replacement = { ...structuredClone(own), uid: 'replacement-uid' };
    snapshot.resources.push(replacement);
    snapshot.facts.projects = [{ ...facts.projects[0]!, projectId: otherId }];
    snapshot.sources = [{ key: 'same-namespace', kind: 'Pod', namespace: target.namespace, batchId: '1', resourceVersion: '1', state: 'complete', count: 1 }];
    const result = withoutProjectSnapshot(snapshot, scope);
    expect(result.resources.some((resource) => resource.uid === own.uid)).toBe(false);
    expect(result.resources.some((resource) => resource.uid === replacement.uid)).toBe(true);
    expect(result.facts.projects[0]?.projectId).toBe(otherId); expect(result.sources).toEqual(snapshot.sources);
  });
  test('prunes owned metrics, counter segments and storage samples without clearing shared node observations', async () => {
    const f = metricsFixture(); await observeMetrics(f.deps, metricsTicket, new AbortController().signal);
    const input = structuredClone(f.observation()), before = structuredClone(input), scope = clusterProjectScope(target, [f.inventory], input.identities);
    const ownedUid = f.pod.metadata.uid!, nearUid = ownedUid + '-different';
    input.counters[ownedUid + '/cpu'] = { at: input.at, instance: ownedUid, value: '1' };
    input.counters[nearUid + '/cpu'] = { at: input.at, instance: nearUid, value: '2' };
    const result = withoutProjectObservation(input, scope);
    expect(result.usages.some((usage) => usage.projectId === target.id)).toBe(false);
    expect(result.capacity.projects[target.id]).toBeUndefined(); expect(result.capacity.managed.pods).toBe(0);
    expect(result.nodes.map((node) => node.metrics)).toEqual(input.nodes.map((node) => node.metrics)); expect(result.capacity.metrics).toEqual(input.capacity.metrics);
    expect(result.nodes.flatMap((node) => node.managedPodIds).some((id) => scope.resources.some((entry) => entry.id === id))).toBe(false);
    expect(result.counters[ownedUid + '/cpu']).toBeUndefined(); expect(result.counters[nearUid + '/cpu']).toBeDefined();
    expect(result.storageTargets).toHaveLength(0); expect(before.usages.some((usage) => usage.projectId === target.id)).toBe(true);
  });
  test('keeps another project current counters and storage targets when the same UID has prior project history', async () => {
    const f = metricsFixture(); await observeMetrics(f.deps, metricsTicket, new AbortController().signal);
    const input = structuredClone(f.observation()), scope = clusterProjectScope(target, [f.inventory], input.identities);
    for (const usage of input.usages) if (usage.projectId === target.id) usage.projectId = otherId;
    const uid = f.pvc.metadata.uid!; input.counters[uid + '/bytes'] = { at: input.at, instance: uid, value: '3' };
    const result = withoutProjectObservation(input, scope);
    expect(result.usages).toEqual(input.usages); expect(result.counters[uid + '/bytes']).toEqual(input.counters[uid + '/bytes']);
    expect(result.storageTargets).toEqual(input.storageTargets);
  });
  test('removes unresolved observations for the exact original identity and preserves an explicit platform owner', async () => {
    const f = metricsFixture(); await observeMetrics(f.deps, metricsTicket, new AbortController().signal);
    const input = structuredClone(f.observation()), scope = clusterProjectScope(target, [f.inventory], input.identities), owned = input.usages.filter((usage) => usage.projectId === target.id);
    for (const usage of owned) { delete usage.projectId; usage.scope = 'unresolved'; }
    for (const history of input.identities) if (history.projectId === target.id) { delete history.projectId; history.scope = 'unresolved'; history.versions = history.versions.map((version) => ({ from: version.from, name: version.name, namespace: version.namespace, scope: 'unresolved' })); }
    const result = withoutProjectObservation(input, scope);
    expect(result.usages.some((usage) => owned.some((entry) => entry.uid === usage.uid))).toBe(false);
    expect(result.identities.some((history) => owned.some((entry) => entry.uid === history.uid))).toBe(false);
    const uid = owned[0]!.uid; owned[0]!.scope = 'system'; input.counters[uid + '/cpu'] = { at: input.at, instance: uid, value: '4' };
    const shared = withoutProjectObservation(input, scope); expect(shared.usages.find((usage) => usage.uid === uid)?.scope).toBe('system'); expect(shared.counters[uid + '/cpu']).toBeDefined();
  });
  test('retains other project historical versions and clears the deleted project names and activity times', () => {
    const input: ClusterHistoryResource = { resourceId: 'resource', uid: 'uid', kind: 'Pod', namespace: 'cs-demo', name: 'private-project-pod', scope: 'project', projectId: target.id,
      firstSeen: '2026-09-01T00:00:00Z', lastSeen: '2026-09-03T00:00:00Z', deleted: false, versions: [
        { from: '2026-09-01T00:00:00Z', to: '2026-09-02T00:00:00Z', name: 'other-pod', namespace: 'cs-other', scope: 'project', projectId: otherId },
        { from: '2026-09-02T00:00:00Z', name: 'private-project-pod', namespace: target.namespace, scope: 'project', projectId: target.id }] };
    const scope = clusterProjectScope(target, [], [input]), result = withoutProjectHistory(input, scope)!;
    expect(result).toMatchObject({ name: 'other-pod', namespace: 'cs-other', projectId: otherId, deleted: true, lastSeen: '2026-09-02T00:00:00Z' });
    expect(JSON.stringify(result)).not.toContain(target.id); expect(JSON.stringify(result)).not.toContain('private-project-pod');
    expect(withoutProjectHistory({ ...input, versions: [input.versions[1]!] }, scope)).toBeNull();
    expect(withoutProjectHistory({ ...input, projectId: otherId }, scope)?.projectId).toBe(otherId);
  });
  test('keeps original scope after rows expire and rejects replacement identities and a different target', () => {
    const f = metricsFixture(), scope = clusterProjectScope(target, [f.inventory], []);
    expect(clusterProjectScope(target, [], [], scope)).toEqual(scope);
    const replacement = structuredClone(f.inventory); replacement.resources[0]!.uid = 'replaced';
    expect(() => clusterProjectScope(target, [replacement], [], scope)).toThrow('原UID');
    expect(() => clusterProjectScope({ ...target, namespace: 'cs-replacement' }, [], [], scope)).toThrow('原项目');
    const samples = [{ uid: f.pvc.metadata.uid!, volumeUid: 'own-volume', metric: { name: 'volumeUsed' as const, unit: 'bytes' as const, state: 'fresh' as const, value: '10', source: 'fixture' } },
      { uid: 'other-uid', volumeUid: 'other-volume', metric: { name: 'volumeUsed' as const, unit: 'bytes' as const, state: 'fresh' as const, value: '20', source: 'fixture' } }];
    expect(withoutProjectStorage(samples, scope)).toEqual([samples[1]!]);
  });
  test('removes original name references from another project inspections and operations after the snapshot expires', () => {
    const f = metricsFixture(), scope = clusterProjectScope(target, [f.inventory], []), owned = f.inventory.resources.find((resource) => resource.ownership.scope === 'project')!;
    const foreign = { ...structuredClone(owned), resourceId: 'other-resource', uid: 'other-uid', namespace: 'cs-other', ownership: { scope: 'project' as const, projectId: otherId, projectName: 'Other', slug: 'other', projectKind: 'DigitalWorker', archived: false },
      references: [owned.namespace + '/' + owned.kind + '/' + owned.name, 'cs-other/Secret/other-config'] };
    const inspection = { inspectionId: 'inspection', expiresAt: f.inventory.finishedAt, target: foreign, request: { action: 'delete' as const }, capability: foreign.availableActions[0]!, related: [{ uid: owned.uid, kind: owned.kind, name: owned.name }] };
    const operation = { operationId: 'operation', inspectionId: 'inspection', idempotencyKey: 'original', actorId: 'admin', action: 'delete' as const, target: foreign, params: { action: 'delete' as const }, phase: 'succeeded' as const,
      createdAt: f.inventory.finishedAt, updatedAt: f.inventory.finishedAt, durationMs: 0, traceId: 'trace', httpStatus: 200, reason: 'done', after: foreign };
    expect(withoutProjectInspection(inspection, scope)?.target.references).toEqual(['cs-other/Secret/other-config']);
    expect(withoutProjectInspection(inspection, scope)?.related).toEqual([]);
    expect(withoutProjectOperation(operation, scope)?.target.references).toEqual(['cs-other/Secret/other-config']);
    expect(withoutProjectOperation(operation, scope)?.after?.references).toEqual(['cs-other/Secret/other-config']);
  });
});
