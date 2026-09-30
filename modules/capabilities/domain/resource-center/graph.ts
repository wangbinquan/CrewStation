import type { ProjectId, ProjectResourceEdge, ProjectResourceNode } from '@crewstation/contracts';

export const projectNodeId = (id: ProjectId) => `project:${id}`;
export const allocationNodeId = (projectId: ProjectId, type: string, id: string) => `allocation:${projectId}:${type}:${id}`;
export const resourceNodeId = (id: string) => `resource:${id}`;
export const resourceNode = (id: string, name: string, resourceType: string, category: ProjectResourceNode['category'], overrides: Partial<ProjectResourceNode> = {}): ProjectResourceNode => ({ id, resourceId: null, name, resourceType, category, description: '', kind: 'component', environment: 'project', access: 'owned', source: 'automatic', state: 'configured', stateText: '已配置', observedAt: null, stale: false, facts: [], metrics: [], ownerId: null, memberIds: [], actions: [], pendingRequestIds: [], ...overrides });
export const resourceEdge = (sourceId: string, targetId: string, relation: ProjectResourceEdge['relation'], state: ProjectResourceEdge['state'], label: string): ProjectResourceEdge => ({ id: `${sourceId}:${relation}:${targetId}`, sourceId, targetId, relation, state, label });

/** Only retain relations whose authoritative endpoints were loaded; partial source failures never invent nodes. */
export function mergeResourceGraph(nodes: ProjectResourceNode[], edges: ProjectResourceEdge[]) {
  const unique = new Map<string, ProjectResourceNode>();
  for (const node of nodes) { const old = unique.get(node.id); unique.set(node.id, old ? { ...(old.source === 'observed' ? { ...node, ...old } : { ...old, ...node }), actions: [...new Map([...old.actions, ...node.actions].map((a) => [a.id, a])).values()], metrics: old.source === 'observed' && old.metrics.length ? old.metrics : node.metrics.length ? node.metrics : old.metrics, facts: [...new Map([...old.facts, ...node.facts].map((f) => [f.label, f])).values()], pendingRequestIds: [...new Set([...old.pendingRequestIds, ...node.pendingRequestIds])] } : node); }
  return { nodes: [...unique.values()].sort((a, b) => a.id.localeCompare(b.id)), edges: [...new Map(edges.filter((e) => unique.has(e.sourceId) && unique.has(e.targetId) && e.sourceId !== e.targetId).map((e) => [e.id, e])).values()].sort((a, b) => a.id.localeCompare(b.id)) };
}
