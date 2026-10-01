import type { ProjectResourceNode, ProjectResourceSnapshot } from '@crewstation/contracts';
import type { Translate } from '../../../shared/lib/useT';
import type { NodeStatus, Semantic, Topology, TopologyNode, EdgeKind } from '../../../shared/ui/topology/topologyModel';
import { RESOURCE_DOMAINS, resourceDomain, resourceClass } from './domains';
import type { ResourceDomain } from './domains';

const presentation: Record<ResourceDomain, { semantic: Semantic; lane: number; row: number }> = {
  project: { semantic: 'platform', lane: 0, row: 0 }, namespace: { semantic: 'security', lane: 0, row: 1 }, services: { semantic: 'service', lane: 1, row: 0 },
  storage: { semantic: 'data', lane: 2, row: 0 }, network: { semantic: 'gateway', lane: 1, row: 1 }, platform: { semantic: 'external', lane: 2, row: 1 },
};
const status = (node: ProjectResourceNode): NodeStatus => node.stale ? 'unknown' : /failed|rejected/.test(node.state) ? 'failed' : node.kind === 'request' || /pending|creating|provisioning|applying|requested/.test(node.state) ? 'pending' : /running|active/.test(node.state) ? 'running' : /released|expired|revoked|cancelled/.test(node.state) ? 'idle' : 'ready';
const relations: Record<string, EdgeKind> = { owns: 'owns', 'consumes-quota': 'uses', uses: 'uses', mounts: 'mounts', calls: 'dial', pushes: 'push', grants: 'binds', changes: 'control' };
export interface ResourceTopology { topology: Topology; groups: Map<string, ProjectResourceNode[]>; displayed: Map<string, ProjectResourceNode>; aliases: Map<string, string> }

export function resourceGroupSummary(members: ProjectResourceNode[]) {
  const pendingRequestIds = [...new Set(members.flatMap((node) => [...node.pendingRequestIds, ...(node.kind === 'request' && node.resourceId ? [node.resourceId] : [])]))];
  const states = new Set(members.map(status));
  return { owned: members.filter((node) => node.access === 'owned').length, requestable: members.filter((node) => node.access === 'requestable').length, unavailable: members.filter((node) => node.access === 'unavailable').length, pendingRequestIds,
    status: (['failed', 'unknown', 'pending', 'running', 'ready', 'idle'] as const).find((value) => states.has(value)) ?? 'ready' };
}

/** Both generations of type bookmarks resolve to their domain. Individual bookmarks retain their exact resource. */
export function resourceSelectionId(graph: ResourceTopology, id: string | undefined) {
  if (!id?.startsWith('group:') || graph.displayed.has(id)) return id;
  if (id === 'group:configuration' && graph.displayed.has('group:project')) return 'group:project';
  const [, category, type] = id.split(':');
  return [...graph.groups].find(([, members]) => members.some((member) => member.category === category && resourceClass(member.resourceType) === resourceClass(type ?? '')))?.[0] ?? id;
}

/** Keep matching groups and their real ownership ancestors; never invent a link to the project root. */
export function filterResourceTopology(graph: ResourceTopology, matchingIds: Set<string>): Topology {
  const ids = new Set(graph.topology.nodes.filter((node) => matchingIds.has(node.id) || graph.groups.get(node.id)?.some((member) => matchingIds.has(member.id))).map((node) => node.id));
  const retained = new Set(ids);
  if (graph.displayed.has('group:project')) retained.add('group:project');
  let added = true;
  while (added) {
    added = false;
    for (const edge of graph.topology.edges) if (edge.kind === 'owns' && retained.has(edge.to) && !retained.has(edge.from)) { retained.add(edge.from); added = true; }
  }
  const nodes = graph.topology.nodes.filter((node) => retained.has(node.id));
  return { ...graph.topology, nodes, bands: graph.topology.bands.filter((band) => nodes.some((node) => node.band === band.id)), edges: graph.topology.edges.filter((edge) => retained.has(edge.from) && retained.has(edge.to)) };
}

/** Aggregate identities only. Every visible edge retains its real direction; quotas from distinct scopes are never added. */
export function resourceTopology(snapshot: ProjectResourceSnapshot, t: Translate): ResourceTopology {
  const buckets = new Map<ResourceDomain, ProjectResourceNode[]>(), displayed = new Map<string, ProjectResourceNode>(), groups = new Map<string, ProjectResourceNode[]>(), alias = new Map<string, string>();
  for (const node of snapshot.nodes) {
    const key = resourceDomain(node), rows = buckets.get(key) ?? []; rows.push(node); buckets.set(key, rows);
  }
  for (const key of RESOURCE_DOMAINS) {
    const nodes = buckets.get(key); if (!nodes?.length) continue;
    const first = nodes[0]!, id = `group:${key}`, summary = resourceGroupSummary(nodes); groups.set(id, nodes);
    displayed.set(id, { ...first, id, resourceType: key, kind: 'group', resourceId: null, ownerId: null, environment: 'project', name: t(`resourceCenter.domain.${key}`), description: `${t(`resourceCenter.domainHint.${key}`)} ${t('resourceCenter.groupHint')}`, memberIds: nodes.map((n) => n.id), metrics: [], facts: [], actions: [], pendingRequestIds: summary.pendingRequestIds, stale: nodes.some((n) => n.stale), state: summary.status, stateText: t('resourceCenter.permissionList') });
    for (const node of nodes) alias.set(node.id, id);
  }
  const nodes: TopologyNode[] = [...displayed.values()].map((node) => {
    const members = groups.get(node.id)!, summary = resourceGroupSummary(members);
    return {
    id: node.id, title: node.name, kind: node.resourceType === 'namespace' ? 'component' : 'summary', ...presentation[node.resourceType as ResourceDomain], band: 'resources',
    status: summary.status, statusText: t('resourceCenter.permissionList'), subtitle: t('resourceCenter.groupSummary', { count: members.length }), counts: [[t('resourceCenter.access.owned'), String(summary.owned)], [t('resourceCenter.access.requestable'), String(summary.requestable)], [t('resourceCenter.pending'), String(summary.pendingRequestIds.length)]], abnormal: node.stale || /failed/.test(node.state),
  }; });
  const edges = [...new Map(snapshot.edges.flatMap((edge) => { const from = alias.get(edge.sourceId), to = alias.get(edge.targetId); return from && to && from !== to ? [[`${from}:${to}:${edge.relation}:${edge.state}`, { from, to, kind: relations[edge.relation]!, evidence: edge.state, label: t(`resourceCenter.relation.${edge.relation}`) }] as const] : []; })).values()];
  return { topology: { id: `project-resources:${snapshot.projectId}`, title: t('resourceCenter.title'), lanes: ['', '', ''], bands: [{ id: 'resources', title: '', semantic: 'platform' }], nodes, edges, observedAt: snapshot.observedAt, complete: snapshot.complete }, displayed, groups, aliases: alias };
}
