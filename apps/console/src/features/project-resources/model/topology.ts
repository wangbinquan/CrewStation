import type { ProjectResourceNode, ProjectResourceSnapshot } from '@crewstation/contracts';
import type { Translate } from '../../../shared/lib/useT';
import type { NodeStatus, Semantic, Topology, TopologyNode, EdgeKind } from '../../../shared/ui/topology/topologyModel';
import { numberText, metricLabel, metricLimit } from './workspace';

const categories = ['foundation', 'service', 'execution', 'data', 'integration'] as const;
const semantics: Record<string, Semantic> = { foundation: 'platform', service: 'service', execution: 'development', data: 'data', integration: 'external' };
const status = (node: ProjectResourceNode): NodeStatus => node.stale ? 'unknown' : /failed|rejected/.test(node.state) ? 'failed' : node.kind === 'request' || /pending|creating|provisioning|applying|requested/.test(node.state) ? 'pending' : /running|active/.test(node.state) ? 'running' : /released|expired|revoked|cancelled/.test(node.state) ? 'idle' : 'ready';
const relations: Record<string, EdgeKind> = { owns: 'owns', 'consumes-quota': 'uses', uses: 'uses', mounts: 'mounts', calls: 'dial', pushes: 'push', grants: 'binds', changes: 'control' };
export interface ResourceTopology { topology: Topology; groups: Map<string, ProjectResourceNode[]>; displayed: Map<string, ProjectResourceNode> }

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
  for (const node of snapshot.nodes) { const key = `${node.category}:${node.resourceType}:${node.environment}:${node.access}`; const rows = buckets.get(key) ?? []; rows.push(node); buckets.set(key, rows); }
  for (const [key, nodes] of buckets) {
    if (nodes.length <= 4 || nodes.some((n) => n.kind === 'project')) { for (const node of nodes) { displayed.set(node.id, node); alias.set(node.id, node.id); } continue; }
    const first = nodes[0]!, id = `group:${key}`; groups.set(id, nodes);
    displayed.set(id, { ...first, id, kind: 'group', resourceId: null, name: `${t(`resourceCenter.type.${first.resourceType}`) === `resourceCenter.type.${first.resourceType}` ? first.resourceType : t(`resourceCenter.type.${first.resourceType}`)} · ${nodes.length}`, description: t('resourceCenter.groupHint'), memberIds: nodes.map((n) => n.id), metrics: [], facts: [], actions: [], pendingRequestIds: [...new Set(nodes.flatMap((n) => n.pendingRequestIds))], stale: nodes.some((n) => n.stale), state: nodes.some((n) => /failed/.test(n.state)) ? 'failed' : first.state });
    for (const node of nodes) alias.set(node.id, id);
  }
  const nodes: TopologyNode[] = [...displayed.values()].sort((a, b) => a.id.localeCompare(b.id)).map((node) => ({
    id: node.id, title: node.name, kind: node.kind === 'group' ? 'summary' : node.kind === 'request' ? 'job' : /database|postgres/.test(node.resourceType) ? 'database' : node.resourceType === 'object-space' ? 'object-space' : /volume|pvc/.test(node.resourceType) ? 'volume' : /pod/.test(node.resourceType) ? 'pod' : /task|workload/.test(node.resourceType) ? 'workload' : 'component',
    semantic: semantics[node.category]!, lane: node.kind === 'project' ? 0 : node.kind === 'request' ? 3 : node.kind === 'allocation' || node.kind === 'catalog' ? 1 : 2, band: node.kind === 'project' ? 'project' : node.category,
    status: status(node), statusText: t(`resourceCenter.access.${node.access}`), subtitle: `${t(`resourceCenter.source.${node.source}`)} · ${node.stateText}`, counts: node.kind === 'group' ? [[t('resourceCenter.resources'), String(node.memberIds.length)], [t('resourceCenter.pending'), String(node.pendingRequestIds.length)]] : node.metrics.slice(0, 2).map((metric) => [metricLabel(metric, t), `${metric.used === null ? '' : `${numberText(metric.used)} / `}${metricLimit(metric, t)}`] as const), meta: [node.stateText], abnormal: node.stale || /failed/.test(node.state),
  }));
  const edges = [...new Map(snapshot.edges.flatMap((edge) => { const from = alias.get(edge.sourceId), to = alias.get(edge.targetId); return from && to && from !== to ? [[`${from}:${to}:${edge.relation}:${edge.state}`, { from, to, kind: relations[edge.relation]!, evidence: edge.state, label: t(`resourceCenter.relation.${edge.relation}`) }] as const] : []; })).values()];
  return { topology: { id: `project-resources:${snapshot.projectId}`, title: t('resourceCenter.title'), lanes: ['project', 'capability', 'instance', 'change'].map((v) => t(`resourceCenter.lane.${v}`)), bands: [{ id: 'project', title: snapshot.projectName, semantic: 'platform' }, ...categories.filter((id) => nodes.some((n) => n.band === id)).map((id) => ({ id, title: t(`resourceCenter.category.${id}`), semantic: semantics[id]! }))], nodes, edges, observedAt: snapshot.observedAt, complete: snapshot.complete }, displayed, groups };
}
