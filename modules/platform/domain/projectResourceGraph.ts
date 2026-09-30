import type { ProjectId, ProjectResourceEdge, ProjectResourceNode } from '@crewstation/contracts';

export const projectResourceId = (id: ProjectId) => `project:${id}`;
export const allocationId = (id: ProjectId, type: string, resourceId: string) => `allocation:${id}:${type}:${resourceId}`;
export const recordId = (id: string) => `resource:${id}`;
export const graphNode = (id: string, name: string, type: string, category: ProjectResourceNode['category'], patch: Partial<ProjectResourceNode> = {}): ProjectResourceNode => ({ id, resourceId: null, name, description: '', resourceType: type, category, kind: 'resource', environment: 'project', access: 'owned', source: 'automatic', state: 'configured', stateText: '已配置', observedAt: null, stale: false, facts: [], metrics: [], ownerId: null, memberIds: [], actions: [], pendingRequestIds: [], ...patch });
export const graphEdge = (sourceId: string, targetId: string, relation: ProjectResourceEdge['relation'], state: ProjectResourceEdge['state'], label: string): ProjectResourceEdge => ({ id: `${sourceId}:${relation}:${targetId}`, sourceId, targetId, relation, state, label });
export function resourceQuantity(value: string | undefined, unit: 'cpu' | 'GiB' | 'count'): number | null {
  if (!value) return null;
  const match = /^(\d+(?:\.\d+)?)([numkKMGTPE]|[KMGTPE]i)?$/.exec(value); if (!match) return null;
  const amount = Number(match[1]), suffix = match[2] ?? '', binary = suffix.endsWith('i') ? 1024 ** ('KMGTPE'.indexOf(suffix[0]!) + 1) : 1;
  const decimal: Record<string, number> = { n: 1e-9, u: 1e-6, m: 1e-3, '': 1, k: 1e3, K: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, E: 1e18 };
  const raw = amount * (suffix.endsWith('i') ? binary : decimal[suffix] ?? NaN), result = unit === 'GiB' ? raw / 1024 ** 3 : raw;
  return Number.isFinite(result) ? result : null;
}
