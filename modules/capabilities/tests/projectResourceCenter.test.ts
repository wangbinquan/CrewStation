import { expect, test } from 'bun:test';
import type { Actor, ProjectId, ResourceRequestDto, ResourceTargetInspection, UserId } from '@crewstation/contracts';
import { IDENTITY_HEADERS, ProjectDtoSchema } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import { fixedClock } from '@crewstation/kernel';
import type { ResourceCenterSources } from '../ports/resourceCenter';
import { projectResourceSnapshot } from '../application/resource-center/snapshot';
import { allocationNodeId, resourceNode } from '../domain/resource-center/graph';
import { projectResourceRoutes } from '../http/projectResourceRoutes';

const projectId = Bun.randomUUIDv7() as ProjectId, userId = Bun.randomUUIDv7() as UserId, actor: Actor = { userId, isAdmin: false }, at = '2026-09-30T00:00:00.000Z';
const project = ProjectDtoSchema.parse({ id: projectId, name: 'Resource test', slug: 'resources', kind: 'DigitalWorker', namespace: 'cs-resources', ownerUserId: userId, state: 'active', createdAt: at });
const target = { resourceType: 'namespace-quota' as const, resourceId: projectId, action: 'set-quota' as const };
const metric = { key: 'pods', label: 'Pods', scopeId: `namespace:${projectId}`, unit: '个', used: 2, reserved: null, limit: 4, requestedLimit: null, limitKind: 'value' as const, observedAt: at };
const inspection: ResourceTargetInspection = { view: { target, name: 'Namespace quota', revision: 'revision', current: { pods: 6 }, fields: [], impact: [], owned: true, available: true, metrics: [{ ...metric, used: null, limit: 6 }] }, policy: null, requestable: true, actions: [{ id: 'quota', kind: 'request', target, label: 'Adjust', fields: [], impact: [], enabled: true }] };
const request = (id = Bun.randomUUIDv7()): ResourceRequestDto => ({ id: id as ResourceRequestDto['id'], projectId, target, targetName: 'Namespace quota', requestedBy: userId, requesterName: null, reason: 'More pods for tests', origin: 'owner-request', state: 'pending', version: 1, baseRevision: 'revision', baseValues: { pods: 6 }, requestedValues: { pods: 8 }, approvedValues: null, decidedBy: null, deciderName: null, decisionReason: null, createdAt: at, updatedAt: at, appliedAt: null, failure: null, effect: null, requestKey: id });
function fixture(): ResourceCenterSources {
  return { authorize: async () => 'owner', project: async () => project, targets: async (_a, _p, type) => type === 'namespace-quota' ? [inspection] : [], requests: async () => ({ items: [], nextCursor: null }), activeRequests: async () => ({ items: [], nextCursor: null }), legacyRequests: async () => [], sources: [] };
}
test('actual quota wins over desired configuration; active changes attach once and keep the effective value', async () => {
  const sources = fixture(), pending = request(), id = allocationNodeId(projectId, target.resourceType, projectId);
  sources.requests = async () => ({ items: [pending], nextCursor: 'older' }); sources.activeRequests = async () => ({ items: [pending], nextCursor: null });
  sources.sources = [{ id: 'observation', name: 'Observation', load: async () => ({ nodes: [resourceNode(id, 'Quota', 'namespace-quota', 'foundation', { resourceId: projectId, source: 'observed', metrics: [metric] })], edges: [{ id: 'dangling', sourceId: 'missing', targetId: id, relation: 'uses', state: 'observed', label: '' }] }) }];
  const value = await projectResourceSnapshot(sources, fixedClock(at))(actor, projectId), quota = value.nodes.find((n) => n.id === id)!;
  expect(value.complete).toBe(true); expect(value.requests).toHaveLength(1); expect(value.requestsNextCursor).toBe('older');
  expect(quota.metrics[0]).toMatchObject({ used: 2, limit: 4, requestedLimit: 8 }); expect(quota.pendingRequestIds).toEqual([pending.id]); expect(quota.actions[0]?.enabled).toBe(false);
  expect(value.edges.some((e) => e.id === 'dangling')).toBe(false); expect(value.edges.find((e) => e.sourceId === `request:${pending.id}`)).toMatchObject({ targetId: id, state: 'proposed' });
});
test('partial sources and withdrawn targets preserve known requests and healthy facts without inventing quota', async () => {
  const sources = fixture(), pending = request(); sources.targets = async () => []; sources.activeRequests = async () => ({ items: [pending], nextCursor: 'remaining' });
  sources.sources = [{ id: 'broken', name: 'Broken', load: async () => { throw new Error('temporarily unavailable'); } }, { id: 'healthy', name: 'Healthy', load: async () => ({ nodes: [resourceNode('database', 'DB', 'database', 'data')], edges: [], complete: false, message: 'first page' }) }];
  sources.legacyRequests = async () => [{ id: 'legacy', resourceType: 'api-operation', targetResourceId: 'operation', name: 'Existing API request', state: 'pending', reason: 'Access', requestedBy: userId, requesterName: null, createdAt: at, values: {}, canDecide: false }];
  const value = await projectResourceSnapshot(sources, fixedClock(at))(actor, projectId);
  expect(value.complete).toBe(false); expect(value.nodes.find((n) => n.id === 'database')).toBeDefined();
  expect(value.nodes.find((n) => n.resourceId === projectId && n.access === 'pending')).toMatchObject({ metrics: [], actions: [], state: 'unavailable' });
  expect(value.sources.filter((s) => !s.complete).map((s) => s.id)).toEqual(['active-requests', 'broken', 'healthy']);
  expect(value.nodes.some((n) => n.id === 'legacy-request:legacy')).toBe(true); expect(value.edges.filter((e) => e.state === 'proposed')).toHaveLength(2);
});
test('requestable catalog stays distinct from allocations; legacy application disables another submission', async () => {
  const sources = fixture(); sources.targets = async (_a, _p, type) => type === 'api-operation' ? [{ ...inspection, view: { ...inspection.view, target: { ...target, resourceType: 'api-operation' }, owned: false }, policy: { resourceType: 'api-operation', resourceId: projectId, revision: 1, requestable: true, updatedAt: at } }] : [];
  sources.legacyRequests = async () => [{ id: 'old', resourceType: 'api-operation', targetResourceId: projectId, name: 'Old', state: 'pending', reason: '', requestedBy: userId, requesterName: null, createdAt: at, values: {}, canDecide: true }];
  const value = await projectResourceSnapshot(sources, fixedClock(at))(actor, projectId), catalog = value.nodes.find((n) => n.id.startsWith('catalog:'))!;
  expect(catalog.access).toBe('pending'); expect(catalog.actions.find((a) => a.kind === 'catalog-policy')?.enabled).toBe(true); expect(catalog.actions.find((a) => a.kind === 'request')?.enabled).toBe(false);
});
test('snapshot HTTP reads require project role and use private no-store; unsupported roles are denied', async () => {
  const sources = fixture(); let role = 'developer'; sources.authorize = async () => role;
  const api = { projectResources: projectResourceSnapshot(sources, fixedClock(at)) }, app = createApp({ name: 'resources-test' }); app.route('/', projectResourceRoutes(api, async () => false));
  const path = `/v1/projects/${projectId}/resource-center`, headers = { [IDENTITY_HEADERS.userId]: userId };
  expect((await app.request(path)).status).toBe(401); const read = await app.request(path, { headers }); expect(read.status).toBe(200); expect(read.headers.get('cache-control')).toContain('no-store');
  role = 'tester'; expect((await app.request(path, { headers })).status).toBe(403);
});
