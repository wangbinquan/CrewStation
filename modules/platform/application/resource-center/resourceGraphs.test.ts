import { expect, test } from 'bun:test';
import type { Actor, ConfigItemDto, DataResourceDto, ProjectId, ReleaseDto, ResourceRecord, ResourceWorkload, RuntimeImageVersionDto, ServiceId, SlotDto, UserId } from '@crewstation/contracts';
import { ResourceRecordSchema } from '@crewstation/contracts';
import type { ProjectResourceDetailPorts } from '../../ports/projectResourceSources';
import { dataResourceGraph } from './dataGraph';
import { executionResourceGraph } from './executionGraph';
import { serviceResourceGraph } from './serviceGraph';
import { ledgerResourceGraph } from './ledgerGraph';
import { namespaceResourceGraph, configResourceGraph } from './foundationGraph';
import { projectResourceSources } from './projectSources';
import { resourceQuantity } from '../../domain/projectResourceGraph';

const id = () => Bun.randomUUIDv7(), projectId = id() as ProjectId, serviceId = id() as ServiceId, actor: Actor = { userId: id() as UserId, isAdmin: false }, at = new Date().toISOString();
function record(kind: ResourceRecord['kind'], patch: Partial<ResourceRecord> = {}): ResourceRecord { const value = id(); return ResourceRecordSchema.parse({ id: value, projectId, owner: { module: 'task-runtime', ref: value }, kind, phase: 'ready', phaseSince: at, conditions: [], children: [], generation: 1, observedGeneration: 1, actions: [], version: 1, createdAt: at, updatedAt: at, ...patch }); }
function workload(patch: Partial<ResourceWorkload> = {}): ResourceWorkload { return { id: id() as ResourceWorkload['id'], projectId, kind: 'dev-session', state: 'running', taskProfileId: 'frozen-task', parentTaskId: null, computeProfileId: null, runtimeImageVersionId: null, runtimeImageId: null, cpu: '500m', memory: '512Mi', storage: '1Gi', volumeMode: 'retain', podUid: 'real-pod-uid', createdAt: at, updatedAt: at, ...patch }; }
function ports(): ProjectResourceDetailPorts { return { actor, service: async () => ({ serviceId, name: 'Service', namespace: 'cs-graph', identity: 'graph/graph' }), ledger: async () => ({ items: [], counts: {}, cursor: 0 }), workloads: async () => ({ items: [], nextCursor: null }), releases: async () => [], slots: async () => [], releaseUsage: async () => [], config: async () => [], data: async () => [], spaces: async () => [], bindings: async () => [], apiRequests: async () => [], subscriptions: async () => [], imageVersion: async () => { throw new Error('missing version'); }, quota: async () => undefined, repository: async () => ({ pathWithNamespace: 'group/project', defaultBranch: 'main', provider: 'gitlab', state: 'ready', secret: 'not-visible' } as unknown as Awaited<ReturnType<ProjectResourceDetailPorts['repository']>>), mcp: [{ name: 'capabilities', url: 'http://secret-url' }] }; }
test('workspaces use frozen profiles and exact parent volumes; one missing image keeps all workload facts', async () => {
  const p = ports(), parent = workload({ runtimeImageVersionId: 'version' }), child = workload({ kind: 'subtask', parentTaskId: parent.id, computeProfileId: 'frozen-agent', runtimeImageVersionId: 'version' }), other = workload({ runtimeImageVersionId: 'missing' });
  const volume = record('volume', { parentId: parent.id }), unrelated = record('volume', { parentId: other.id }); let calls = 0;
  p.workloads = async () => ({ items: [parent, child, other], nextCursor: null }); p.ledger = async () => ({ items: [volume, unrelated], counts: {}, cursor: 0 });
  p.imageVersion = async (_a, _p, versionId) => { calls++; if (versionId === 'missing') throw new Error('removed'); return { id: versionId, imageId: 'directory', state: 'ready', digest: 'sha256:frozen', environment: { PASSWORD: 'not-visible' } } as unknown as RuntimeImageVersionDto; };
  const graph = await executionResourceGraph(p, actor, projectId);
  expect(graph.complete).toBe(false); expect(calls).toBe(2); expect(graph.nodes.filter((n) => n.resourceType === 'dev-workspace')).toHaveLength(2); expect(graph.nodes.filter((n) => n.resourceType === 'runtime-image-version')).toHaveLength(1);
  expect(graph.edges.filter((e) => e.sourceId === `resource:${child.id}` && e.relation === 'mounts').map((e) => e.targetId)).toEqual([`resource:${volume.id}`]);
  expect(graph.edges.some((e) => e.targetId.endsWith(':frozen-agent'))).toBe(true); expect(JSON.stringify(graph)).not.toContain('PASSWORD');
  let pages = 0; p.workloads = async () => { pages++; return { items: [], nextCursor: 'more' }; }; expect((await executionResourceGraph(p, actor, projectId)).complete).toBe(false); expect(pages).toBe(4);
});
test('both active slots use the same production database; development and expired bindings do not join it', async () => {
  const p = ports(), prod = id(), dev = id(), task = workload(), blue = record('service-slot', { display: { physical: 'blue' } }), green = record('service-slot', { display: { physical: 'green' } });
  p.data = async () => [{ id: prod, env: 'production', kind: 'postgres', state: 'ready', plan: 'shared', envVar: 'CS_DATABASE_URL', secretBox: 'not-visible' }, { id: dev, env: 'development', kind: 'postgres', state: 'ready', plan: 'shared', envVar: 'CS_DATABASE_URL' }] as unknown as DataResourceDto[];
  p.ledger = async () => ({ items: [blue, green], counts: {}, cursor: 0 }); p.releaseUsage = async () => ['blue', 'green'].map((physical) => ({ physical, releaseId: id() })) as unknown as Awaited<ReturnType<ProjectResourceDetailPorts['releaseUsage']>>;
  const binding = { id: id(), taskId: task.id, state: 'active' as const, mode: 'diagnostic-readonly' as const, ttlMinutes: 30, expiresAt: new Date(Date.now() + 60000).toISOString(), requestedBy: actor.userId, createdAt: at };
  p.bindings = async () => [binding, { ...binding, id: id(), expiresAt: '2020-01-01T00:00:00Z' }, { ...binding, id: id(), mode: 'development' }];
  const graph = await dataResourceGraph(p, actor, projectId), edges = graph.edges.filter((e) => [blue.id, green.id].some((slot) => e.sourceId === `resource:${slot}`));
  expect(edges.map((e) => e.targetId)).toEqual([`resource:${prod}`, `resource:${prod}`]); expect(graph.nodes.find((n) => n.resourceId === prod)?.metrics[0]?.limitKind).toBe('shared');
  expect(graph.edges.filter((e) => e.targetId === `resource:${prod}` && e.state === 'observed')).toHaveLength(1); expect(JSON.stringify(graph)).not.toContain('secretBox');
  expect(graph.nodes.find((node) => node.state === 'expired')?.stateText).toBe('expired');
  p.releaseUsage = async () => { throw new Error('offline'); }; const partial = await dataResourceGraph(p, actor, projectId); expect(partial.complete).toBe(false); expect(partial.nodes.some((n) => n.resourceId === prod)).toBe(true);
});
test('ledger retains UID based physical identity and quota consumers, including archive and stopping execution', async () => {
  const p = ports(), parent = record('dev-workspace'), child = record('archive-execution', { parentId: parent.id, phase: 'stopping', children: [{ kind: 'Pod', name: 'same-name', namespace: 'cs-graph', uid: 'pod-one', phase: 'Running', ready: true, observedAt: at }] }), fresh = record('business-workspace', { children: [{ kind: 'Pod', name: 'same-name', namespace: 'cs-graph', uid: 'pod-two', phase: 'Running', ready: true, observedAt: at }] });
  p.ledger = async () => ({ items: [parent, child, fresh], counts: {}, cursor: 0 }); const graph = await ledgerResourceGraph(p, actor, projectId);
  expect(graph.nodes.filter((n) => n.resourceType === 'Pod').map((n) => n.resourceId)).toEqual(['pod-one', 'pod-two']); expect(graph.edges.filter((e) => e.relation === 'consumes-quota' && e.state === 'observed')).toHaveLength(3);
  expect(graph.edges.find((e) => e.targetId === `resource:${child.id}`)).toMatchObject({ sourceId: `resource:${parent.id}`, relation: 'owns' });
  p.ledger = async () => ({ items: Array.from({ length: 2001 }, () => record('namespace')), counts: {}, cursor: 0 }); expect((await ledgerResourceGraph(p, actor, projectId)).complete).toBe(false);
});
test('actual quantities and config metadata expose no values; missing observations remain unknown', async () => {
  const p = ports(); p.quota = async () => ({ status: { hard: { 'requests.cpu': '4000m', 'requests.memory': '8Gi', pods: '30', persistentvolumeclaims: '20' }, used: { 'requests.cpu': '500m', 'requests.memory': '512Mi', pods: '2' } } });
  const node = (await namespaceResourceGraph(p, actor, projectId)).nodes[0]!; expect(node.metrics.map((m) => m.limit)).toEqual([4, 8, 30, 20]); expect(node.metrics.map((m) => m.used)).toEqual([0.5, 0.5, 2, null]);
  p.quota = async () => undefined; expect((await namespaceResourceGraph(p, actor, projectId)).nodes[0]!.metrics.every((m) => m.limitKind === 'unknown')).toBe(true); expect(resourceQuantity('invalid', 'count')).toBeNull();
  p.config = async (_a, _p, env) => [{ id: id(), definitionId: 'key', name: 'PASSWORD', bindingName: 'PASSWORD', isSecret: true, version: 1, updatedAt: at, value: 'NEVER-SHOW', env }] as unknown as ConfigItemDto[];
  const config = await configResourceGraph(p, actor, projectId); expect(config.nodes).toHaveLength(2); expect(JSON.stringify(config)).not.toContain('NEVER-SHOW'); expect(config.nodes.map((n) => n.environment)).toEqual(['development', 'production']);
});
test('release relations include fixed manifests and old active releases, without guessing an image', async () => {
  const p = ports(), releaseId = id(), slot = record('service-slot', { display: { physical: 'blue' } }), build = record('build-job', { display: { releaseId } });
  p.ledger = async () => ({ items: [slot, build], counts: {}, cursor: 0 }); p.releases = async () => [{ id: releaseId, tag: 'v1', status: 'ready', commitSha: 'fixed-sha', branch: 'main', updatedAt: at }] as unknown as ReleaseDto[];
  p.slots = async () => [{ releaseId, tag: 'v1' }] as unknown as SlotDto[];
  p.releaseUsage = async () => [{ releaseId, physical: 'blue', role: 'prod', servicePlanId: 'plan', taskProfileId: 'task', computeProfileIds: ['compute'], runtimeImageVersionIds: ['missing'], objectPlanId: 'objects', configDefinitionIds: ['key'], requestedApiIds: ['op'], eventTypeIds: ['event'] }];
  const graph = await serviceResourceGraph(p, actor, projectId); expect(graph.complete).toBe(false); expect(graph.edges.find((e) => e.sourceId === `resource:${slot.id}`)).toMatchObject({ targetId: `release:${releaseId}` }); expect(graph.edges.some((e) => e.targetId === `resource:${build.id}`)).toBe(true);
  expect(graph.edges.some((e) => e.targetId === `config:${projectId}:production:key`)).toBe(true); expect(graph.edges.some((e) => e.targetId.startsWith('image-version:'))).toBe(false);
});
test('distinct subscription handlers and safe repository/MCP metadata preserve original legacy request states', async () => {
  const p = ports(), eventTypeId = id(); p.subscriptions = async () => ['/one', '/two'].map((handlerPath) => ({ id: id(), serviceId, eventTypeId, handlerPath, eventType: 'source.updated', state: 'active' }));
  p.apiRequests = async () => [{ id: id(), serviceId, operationId: 'op', state: 'pending', reason: 'Need API', requestedBy: actor.userId, createdAt: at }];
  const sources = projectResourceSources(p), integration = await sources.sources.find((s) => s.id === 'integration')!.load(actor, projectId), repository = await sources.sources.find((s) => s.id === 'repository')!.load(actor, projectId);
  expect(integration.nodes.filter((n) => n.resourceType === 'event-subscription')).toHaveLength(2); expect(integration.edges.filter((e) => e.sourceId === `event:${projectId}:${eventTypeId}`)).toHaveLength(2);
  expect(JSON.stringify(integration)).not.toContain('secret-url'); expect(JSON.stringify(repository)).not.toContain('not-visible'); expect((await sources.legacyRequests(actor, projectId))[0]).toMatchObject({ state: 'pending', canDecide: false });
});
