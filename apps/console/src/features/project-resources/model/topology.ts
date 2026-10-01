import type { ProjectResourceNode, ProjectResourceSnapshot } from '@crewstation/contracts';
import type { Translate } from '../../../shared/lib/useT';
import type { NodeStatus, Semantic, Topology, TopologyNode, EdgeKind } from '../../../shared/ui/topology/topologyModel';
import { numberText, metricLabel, metricLimit, label } from './workspace';

const categories = ['foundation', 'service', 'execution', 'data', 'integration'] as const;
const semantics: Record<string, Semantic> = { foundation: 'platform', service: 'service', execution: 'development', data: 'data', integration: 'external' };
const status = (node: ProjectResourceNode): NodeStatus => node.stale ? 'unknown' : /failed|rejected/.test(node.state) ? 'failed' : node.kind === 'request' || /pending|creating|provisioning|applying|requested/.test(node.state) ? 'pending' : /running|active/.test(node.state) ? 'running' : /released|expired|revoked|cancelled/.test(node.state) ? 'idle' : 'ready';
const relations: Record<string, EdgeKind> = { owns: 'owns', 'consumes-quota': 'uses', uses: 'uses', mounts: 'mounts', calls: 'dial', pushes: 'push', grants: 'binds', changes: 'control' };
const resourceClasses: Record<string, string> = { Namespace: 'namespace', PostgresDatabase: 'database', PostgresRole: 'database-role', ResourceQuota: 'namespace-quota', IngressRoute: 'route', NetworkPolicy: 'network-policy', 'network-policy-set': 'network-policy', 'rate-limit-policy': 'gateway-limit' };
const resourceClass = (type: string) => resourceClasses[type] ?? type;
export interface ResourceTopology { topology: Topology; groups: Map<string, ProjectResourceNode[]>; displayed: Map<string, ProjectResourceNode>; aliases: Map<string, string> }

export function resourceGroupSummary(members: ProjectResourceNode[]) {
  const pendingRequestIds = [...new Set(members.flatMap((node) => [...node.pendingRequestIds, ...(node.kind === 'request' && node.resourceId ? [node.resourceId] : [])]))];
  const states = new Set(members.map(status));
  return { owned: members.filter((node) => node.access === 'owned').length, requestable: members.filter((node) => node.access === 'requestable').length, unavailable: members.filter((node) => node.access === 'unavailable').length, pendingRequestIds,
    status: (['failed', 'unknown', 'pending', 'running', 'ready', 'idle'] as const).find((value) => states.has(value)) ?? 'ready' };
}

/** Older environment/access group bookmarks resolve to the new type card. Individual bookmarks retain their exact resource. */
export function resourceSelectionId(graph: ResourceTopology, id: string | undefined) {
  if (!id?.startsWith('group:') || graph.displayed.has(id)) return id;
  const [, category, type] = id.split(':'), canonical = `group:${category}:${resourceClass(type ?? '')}`;
  if (graph.displayed.has(canonical)) return canonical;
  return [...graph.groups.keys()].sort((a, b) => b.length - a.length).find((key) => id.startsWith(`${key}:`)) ?? id;
}

const resourceLane = (node: ProjectResourceNode) => node.kind === 'project' ? 0 : node.kind === 'request' ? 3 : node.kind === 'allocation' || node.kind === 'catalog' ? 1 : 2;

/** Keep matching groups and their real ownership ancestors; never invent a link to the project root. */
export function filterResourceTopology(graph: ResourceTopology, matchingIds: Set<string>): Topology {
  const ids = new Set(graph.topology.nodes.filter((node) => matchingIds.has(node.id) || graph.groups.get(node.id)?.some((member) => matchingIds.has(member.id))).map((node) => node.id));
  const retained = new Set(ids);
  for (const node of graph.displayed.values()) if (node.kind === 'project') retained.add(node.id);
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
  const buckets = new Map<string, ProjectResourceNode[]>(), displayed = new Map<string, ProjectResourceNode>(), groups = new Map<string, ProjectResourceNode[]>(), alias = new Map<string, string>();
  for (const node of snapshot.nodes) {
    if (node.kind === 'project') { displayed.set(node.id, node); alias.set(node.id, node.id); continue; }
    const key = `${node.category}:${resourceClass(node.resourceType)}`, rows = buckets.get(key) ?? []; rows.push(node); buckets.set(key, rows);
  }
  for (const [key, nodes] of buckets) {
    const first = nodes[0]!, id = `group:${key}`, summary = resourceGroupSummary(nodes), resourceType = resourceClass(first.resourceType); groups.set(id, nodes);
    displayed.set(id, { ...first, id, resourceType, kind: 'group', resourceId: null, ownerId: null, environment: 'project', name: `${label(t, `type.${resourceType}`, resourceType)} · ${nodes.length}`, description: t('resourceCenter.groupHint'), memberIds: nodes.map((n) => n.id), metrics: [], facts: [], actions: [], pendingRequestIds: summary.pendingRequestIds, stale: nodes.some((n) => n.stale), state: summary.status, stateText: t('resourceCenter.permissionList') });
    for (const node of nodes) alias.set(node.id, id);
  }
  const nodes: TopologyNode[] = [...displayed.values()].sort((a, b) => a.id.localeCompare(b.id)).map((node) => {
    const members = groups.get(node.id), summary = members ? resourceGroupSummary(members) : undefined;
    return {
    id: node.id, title: node.name, kind: node.kind === 'group' ? 'summary' : node.kind === 'request' ? 'job' : /database|postgres/.test(node.resourceType) ? 'database' : node.resourceType === 'object-space' ? 'object-space' : /volume|pvc/.test(node.resourceType) ? 'volume' : /pod/.test(node.resourceType) ? 'pod' : /task|workload/.test(node.resourceType) ? 'workload' : 'component',
    semantic: semantics[node.category]!, lane: members ? Math.min(...members.map(resourceLane)) : resourceLane(node), band: node.kind === 'project' ? 'project' : node.category,
    status: summary?.status ?? status(node), statusText: summary ? t('resourceCenter.permissionList') : t(`resourceCenter.access.${node.access}`), subtitle: summary ? t('resourceCenter.groupSummary', { count: node.memberIds.length }) : `${t(`resourceCenter.source.${node.source}`)} · ${node.stateText}`, counts: summary ? [[t('resourceCenter.access.owned'), String(summary.owned)], [t('resourceCenter.access.requestable'), String(summary.requestable)], [t('resourceCenter.pending'), String(summary.pendingRequestIds.length)]] : node.metrics.slice(0, 2).map((metric) => [metricLabel(metric, t), `${metric.used === null ? '' : `${numberText(metric.used)} / `}${metricLimit(metric, t)}`] as const), meta: [node.stateText], abnormal: node.stale || /failed/.test(node.state),
  }; });
  const edges = [...new Map(snapshot.edges.flatMap((edge) => { const from = alias.get(edge.sourceId), to = alias.get(edge.targetId); return from && to && from !== to ? [[`${from}:${to}:${edge.relation}:${edge.state}`, { from, to, kind: relations[edge.relation]!, evidence: edge.state, label: t(`resourceCenter.relation.${edge.relation}`) }] as const] : []; })).values()];
  return { topology: { id: `project-resources:${snapshot.projectId}`, title: t('resourceCenter.title'), lanes: ['project', 'capability', 'instance', 'change'].map((v) => t(`resourceCenter.lane.${v}`)), bands: [{ id: 'project', title: snapshot.projectName, semantic: 'platform' }, ...categories.filter((id) => nodes.some((n) => n.band === id)).map((id) => ({ id, title: t(`resourceCenter.category.${id}`), semantic: semantics[id]! }))], nodes, edges, observedAt: snapshot.observedAt, complete: snapshot.complete }, displayed, groups, aliases: alias };
}
